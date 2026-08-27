#!/usr/bin/env bash
# Root-owned, fail-closed helper for the exact FetanAgent staging beta Compose project.
# Install this reviewed file as /usr/local/sbin/fetanagent-staging-deploy-helper with
# root:root ownership and mode 0755. The SSH deployment identity may sudo only this helper.

set -euo pipefail

readonly EXPECTED_SUDO_USER='fetanagent-admin'
readonly HELPER_PATH='/usr/local/sbin/fetanagent-staging-deploy-helper'
readonly RELEASE_ROOT='/srv/fetanagent/releases'
readonly SECRET_ROOT='/srv/fetanagent/secrets/staging'
readonly PROJECT_NAME='fetanagent-staging-beta'
readonly LEGACY_BRAND='pay''replayy'
readonly LEGACY_ADMIN="${LEGACY_BRAND}-admin"
readonly LEGACY_HOME="/home/$LEGACY_ADMIN"
readonly LEGACY_HELPER="/usr/local/sbin/${LEGACY_BRAND}-staging-deploy-helper"
readonly LEGACY_PROJECT_NAME="${LEGACY_BRAND}-staging-beta"
readonly LEGACY_SECRET_ROOT="/srv/${LEGACY_BRAND}/secrets/staging"
readonly LEGACY_SYSTEMD_MARKER="$LEGACY_BRAND"
readonly LEGACY_SUDOERS="/etc/sudoers.d/${LEGACY_BRAND}-staging-deploy"
readonly LOCAL_DOCKER_SOCKET='unix:///var/run/docker.sock'
readonly DOCKER_DATA_ROOT='/var/lib/docker'
readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly STAGING_DIRECT_DATABASE_HOST='db.spzpiyxheappsfyswewl.supabase.co'
readonly PUBLIC_IPV4='178.128.39.89'
readonly FRESH_PUBLIC_IPV4='161.35.41.232'
readonly PUBLIC_DOMAINS=('fetanagent.com' 'www.fetanagent.com' 'owner.fetanagent.com')
readonly GATEWAY_STATE_ROOT='/var/lib/fetanagent-gateway'
readonly BOT_STARTUP_RECEIPT_ROOT='/var/lib/fetanagent-bot-startup-receipt'
readonly BOT_STARTUP_RECEIPT="$BOT_STARTUP_RECEIPT_ROOT/bot-v1"
readonly BOT_STARTUP_RECEIPT_VERSION='1'
readonly KEMERBET_AGENT_IDENTITY_HMAC_KEY='/etc/fetanagent/executor-secrets/kemerbet_agent_identity_hmac_key'
readonly KEMERBET_AGENT_IDENTITY_BINDINGS='/etc/fetanagent/executor-secrets/kemerbet_agent_identity_bindings'
readonly KEMERBET_READINESS_PLAYER_IDS='/etc/fetanagent/executor-secrets/kemerbet_no_transfer_readiness_player_ids'
readonly KEMERBET_SELECTOR_CONTRACT='/etc/fetanagent/executor-config/kemerbet-selector-contract.v2.json'
readonly KEMERBET_READINESS_OUTPUT_ROOT='/var/lib/fetanagent/kemerbet-readiness-seal-output'
readonly KEMERBET_READINESS_BINDING="$KEMERBET_READINESS_OUTPUT_ROOT/kemerbet_agent_identity_bindings"
readonly KEMERBET_V1_RETIREMENT_ROOT='/var/lib/fetanagent/kemerbet-readiness-binding-v1-retirement'
readonly KEMERBET_V1_RETIREMENT_ROOT_INSTALLING="${KEMERBET_V1_RETIREMENT_ROOT}.installing"
readonly KEMERBET_V1_RETIREMENT_INTENT="$KEMERBET_V1_RETIREMENT_ROOT/intent-v1"
readonly KEMERBET_V1_RETIREMENT_ARCHIVE="$KEMERBET_V1_RETIREMENT_ROOT/archive-v1"
readonly KEMERBET_V1_RETIREMENT_COMPLETION="$KEMERBET_V1_RETIREMENT_ROOT/completed-v1"
readonly KEMERBET_V1_RETIREMENT_CONFIRMATION='I-UNDERSTAND-THIS-RETIRES-THE-EXACT-V1-BINDING-FOR-V2-RESEAL'
readonly KEMERBET_V2_V3_SUCCESSOR_PARENT='/var/lib/fetanagent/kemerbet-readiness-v2-v3-successor'
readonly KEMERBET_V3_HELPER_ROTATION_PARENT='/var/lib/fetanagent/kemerbet-readiness-v3-helper-rotation'
readonly KEMERBET_V3_HELPER_ROTATION_V2_PARENT='/var/lib/fetanagent/kemerbet-readiness-v3-helper-rotation-v2'
readonly KEMERBET_V3_HELPER_ROTATION_V3_PARENT='/var/lib/fetanagent/kemerbet-readiness-v3-helper-rotation-v3'
readonly KEMERBET_V3_HELPER_ROTATION_V4_PARENT='/var/lib/fetanagent/kemerbet-readiness-v3-helper-rotation-v4'
readonly KEMERBET_V3_HELPER_ROTATION_V5_PARENT='/var/lib/fetanagent/kemerbet-readiness-v3-helper-rotation-v5'
readonly KEMERBET_V3_HELPER_ROTATION_V6_PARENT='/var/lib/fetanagent/kemerbet-readiness-v3-helper-rotation-v6'
readonly KEMERBET_V3_HELPER_ROTATION_V7_PARENT='/var/lib/fetanagent/kemerbet-readiness-v3-helper-rotation-v7'
readonly KEMERBET_V3_HELPER_ROTATION_V8_PARENT='/var/lib/fetanagent/kemerbet-readiness-v3-helper-rotation-v8'
readonly KEMERBET_V3_HELPER_ROTATION_V9_PARENT='/var/lib/fetanagent/kemerbet-readiness-v3-helper-rotation-v9'
readonly KEMERBET_V3_HELPER_ROTATION_V10_PARENT='/var/lib/fetanagent/kemerbet-readiness-v3-helper-rotation-v10'
readonly KEMERBET_V3_HELPER_ROTATION_V11_PARENT='/var/lib/fetanagent/kemerbet-readiness-v3-helper-rotation-v11'
readonly KEMERBET_V1_REINSTALL_JOURNAL='/var/lib/fetanagent/kemerbet-v1-retirement-secrets-reinstall-v1'
readonly KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING="${KEMERBET_V1_REINSTALL_JOURNAL}.installing"
readonly KEMERBET_RECHECK_RECEIPT_ROOT='/var/lib/fetanagent/kemerbet-readiness-recheck'
readonly KEMERBET_RECHECK_RECEIPT="$KEMERBET_RECHECK_RECEIPT_ROOT/ready-v1"
readonly KEMERBET_RECHECK_PROMOTION_ROOT='/var/lib/fetanagent/kemerbet-readiness-recheck-promotion'
readonly KEMERBET_RECHECK_PROMOTION_JOURNAL="$KEMERBET_RECHECK_PROMOTION_ROOT/pending-v1"
readonly KEMERBET_RECHECK_CANDIDATE_ROOT='/etc/fetanagent/executor-secrets/.kemerbet-readiness-recheck-candidate'
readonly KEMERBET_RECHECK_CANDIDATE_BINDING="$KEMERBET_RECHECK_CANDIDATE_ROOT/kemerbet_agent_identity_bindings"
readonly KEMERBET_RECHECK_CONTAINER="$PROJECT_NAME-kemerbet-no-transfer-readiness-once"
readonly KEMERBET_RECHECK_BROWSER_CONTAINER="$PROJECT_NAME-kemerbet-readiness-browser-once"
readonly KEMERBET_RECHECK_PROXY_CONTAINER="$PROJECT_NAME-kemerbet-readiness-egress-proxy-once"
readonly KEMERBET_RECHECK_AUTHORIZER_CONTAINER="$PROJECT_NAME-kemerbet-readiness-authorizer-once"
readonly KEMERBET_RECHECK_SNAPSHOT_CONTAINER="$PROJECT_NAME-kemerbet-readiness-profile-snapshot-copy-once"
readonly KEMERBET_RECHECK_SNAPSHOT_VERIFY_CONTAINER="$PROJECT_NAME-kemerbet-readiness-profile-snapshot-verify-once"
readonly KEMERBET_RECHECK_ORIGINAL_VERIFY_CONTAINER="$PROJECT_NAME-kemerbet-readiness-profile-original-verify-once"
readonly KEMERBET_RECHECK_CONTROL_NETWORK="${PROJECT_NAME}_kemerbet_readiness_control"
readonly KEMERBET_RECHECK_PROXY_NETWORK="${PROJECT_NAME}_kemerbet_readiness_proxy"
readonly KEMERBET_RECHECK_EGRESS_NETWORK="${PROJECT_NAME}_kemerbet_readiness_egress"
readonly KEMERBET_RECHECK_CONTROL_IPV4_SUBNET='172.31.254.0/29'
readonly KEMERBET_RECHECK_CONTROL_IPV4_GATEWAY='172.31.254.1'
readonly KEMERBET_RECHECK_CONTROLLER_CONTROL_IPV4='172.31.254.2'
readonly KEMERBET_RECHECK_BROWSER_CONTROL_IPV4='172.31.254.3'
readonly KEMERBET_RECHECK_CONTROL_IPV6_SUBNET='fd5e:7a9e:1::/64'
readonly KEMERBET_RECHECK_CONTROL_IPV6_GATEWAY='fd5e:7a9e:1::1'
readonly KEMERBET_RECHECK_CONTROLLER_CONTROL_IPV6='fd5e:7a9e:1::2'
readonly KEMERBET_RECHECK_BROWSER_CONTROL_IPV6='fd5e:7a9e:1::3'
readonly KEMERBET_RECHECK_PROXY_IPV4_SUBNET='172.31.254.8/29'
readonly KEMERBET_RECHECK_PROXY_IPV4_GATEWAY='172.31.254.9'
readonly KEMERBET_RECHECK_PROXY_PROXY_IPV4='172.31.254.10'
readonly KEMERBET_RECHECK_BROWSER_PROXY_IPV4='172.31.254.11'
readonly KEMERBET_RECHECK_PROXY_IPV6_SUBNET='fd5e:7a9e:2::/64'
readonly KEMERBET_RECHECK_PROXY_IPV6_GATEWAY='fd5e:7a9e:2::1'
readonly KEMERBET_RECHECK_PROXY_PROXY_IPV6='fd5e:7a9e:2::2'
readonly KEMERBET_RECHECK_BROWSER_PROXY_IPV6='fd5e:7a9e:2::3'
readonly KEMERBET_RECHECK_RPC_ROOT='/run/fetanagent-kemerbet-readiness-rpc-v1'
readonly KEMERBET_RECHECK_RPC_INSTALLING="$KEMERBET_RECHECK_RPC_ROOT/.capability.installing"
readonly KEMERBET_RECHECK_PROXY_HMAC_INSTALLING="$KEMERBET_RECHECK_RPC_ROOT/.proxy-hmac-key.installing"
readonly KEMERBET_RECHECK_PROXY_NONCE_INSTALLING="$KEMERBET_RECHECK_RPC_ROOT/.proxy-run-nonce.installing"
readonly KEMERBET_RECHECK_RPC_CONTROLLER_CAPABILITY="$KEMERBET_RECHECK_RPC_ROOT/controller-capability"
readonly KEMERBET_RECHECK_RPC_BROWSER_CAPABILITY="$KEMERBET_RECHECK_RPC_ROOT/browser-capability"
readonly KEMERBET_RECHECK_AUTHORIZER_HMAC_KEY="$KEMERBET_RECHECK_RPC_ROOT/authorizer-hmac-key"
readonly KEMERBET_RECHECK_AUTHORIZER_RUN_NONCE="$KEMERBET_RECHECK_RPC_ROOT/authorizer-run-nonce"
readonly KEMERBET_RECHECK_AUTHORIZER_PLAYER_IDS="$KEMERBET_RECHECK_RPC_ROOT/authorizer-player-ids"
readonly KEMERBET_RECHECK_PROXY_HMAC_KEY="$KEMERBET_RECHECK_RPC_ROOT/proxy-hmac-key"
readonly KEMERBET_RECHECK_PROXY_RUN_NONCE="$KEMERBET_RECHECK_RPC_ROOT/proxy-run-nonce"
readonly KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_BINDINGS="$KEMERBET_RECHECK_RPC_ROOT/proxy-agent-identity-bindings"
readonly KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_HMAC_KEY="$KEMERBET_RECHECK_RPC_ROOT/proxy-agent-identity-hmac-key"
readonly KEMERBET_RECHECK_AUTHORIZATIONS="$KEMERBET_RECHECK_RPC_ROOT/layer7-authorizations"
readonly KEMERBET_RECHECK_BROWSER_ACCOUNT_ID="$KEMERBET_RECHECK_RPC_ROOT/browser-account-id"
readonly KEMERBET_RECHECK_SNAPSHOT_ACCOUNT_ID="$KEMERBET_RECHECK_RPC_ROOT/snapshot-account-id"
readonly KEMERBET_RECHECK_RELEASE_SHA="$KEMERBET_RECHECK_RPC_ROOT/release-sha"
readonly KEMERBET_RECHECK_CONTROLLER_FIREWALL_RELEASE="$KEMERBET_RECHECK_RPC_ROOT/controller-firewall-release"
readonly KEMERBET_RECHECK_BROWSER_FIREWALL_RELEASE="$KEMERBET_RECHECK_RPC_ROOT/browser-firewall-release"
readonly KEMERBET_RECHECK_AUTHORIZER_OUTPUT_ROOT="$KEMERBET_RECHECK_RPC_ROOT/authorizer-output"
readonly KEMERBET_RECHECK_AUTHORIZER_OUTPUT="$KEMERBET_RECHECK_AUTHORIZER_OUTPUT_ROOT/authorizations"
readonly KEMERBET_RECHECK_PROXY_OUTPUT_ROOT="$KEMERBET_RECHECK_RPC_ROOT/proxy-output"
readonly KEMERBET_RECHECK_PROXY_COMPLETION_RECEIPT="$KEMERBET_RECHECK_PROXY_OUTPUT_ROOT/completion-receipt"
readonly KEMERBET_RECHECK_PROFILE_OUTPUT_ROOT="$KEMERBET_RECHECK_RPC_ROOT/profile-output"
readonly KEMERBET_RECHECK_PROFILE_MANIFEST="$KEMERBET_RECHECK_PROFILE_OUTPUT_ROOT/profile-manifest"
readonly KEMERBET_RECHECK_CONTROLLER_STAGE_OUTPUT_ROOT="$KEMERBET_RECHECK_RPC_ROOT/controller-stage-output"
readonly KEMERBET_RECHECK_CONTROLLER_STAGE="$KEMERBET_RECHECK_CONTROLLER_STAGE_OUTPUT_ROOT/stage-v1"
readonly KEMERBET_RECHECK_BROWSER_STAGE_OUTPUT_ROOT="$KEMERBET_RECHECK_RPC_ROOT/browser-stage-output"
readonly KEMERBET_RECHECK_BROWSER_STAGE="$KEMERBET_RECHECK_BROWSER_STAGE_OUTPUT_ROOT/stage-v1"
readonly KEMERBET_RECHECK_PROXY_STAGE_OUTPUT_ROOT="$KEMERBET_RECHECK_RPC_ROOT/proxy-stage-output"
readonly KEMERBET_RECHECK_PROXY_STAGE="$KEMERBET_RECHECK_PROXY_STAGE_OUTPUT_ROOT/stage-v1"
readonly KEMERBET_RECHECK_FIREWALL_RELEASE_CONTENT='fetanagent-kemerbet-readiness-firewall-v1'
readonly KEMERBET_RECHECK_FIREWALL_CHAIN='FETANAGENT-READINESS'
# SHA-256 of the exact four LF-terminated Docker health-test argv entries (CMD, node, -e,
# strict O_NOFOLLOW readiness-marker validator) in compose.staging-beta.yaml.
readonly KEMERBET_RECHECK_PROXY_HEALTH_TEST_SHA256='424d2d9214c1089d7a9ecace5818e5541f3dd3b59324fbcf647503c2802456da'
readonly KEMERBET_RECHECK_PROFILE_SNAPSHOT_VOLUME="$PROJECT_NAME-kemerbet-readiness-profile-snapshot-once"
readonly KEMERBET_RECHECK_ONESHOT_LABEL='com.fetanagent.kemerbet-readiness.oneshot'
readonly KEMERBET_RECHECK_SNAPSHOT_VOLUME_LABEL='com.fetanagent.kemerbet-readiness.snapshot'
readonly KEMERBET_SESSION_CONTROL_VOLUME="${PROJECT_NAME}_kemerbet_session_control"
readonly KEMERBET_OWNER_RECEIPT_PARENT='/var/lib/fetanagent'
readonly KEMERBET_OWNER_RECEIPT_ROOT="$KEMERBET_OWNER_RECEIPT_PARENT/kemerbet-readiness-cohort-receipts"
readonly KEMERBET_OWNER_RECEIPT_CONTAINER_ROOT='/run/fetanagent-kemerbet-readiness-cohort-receipts'
readonly KEMERBET_OWNER_STAGED_PLAYER_IDS_NAME='kemerbet-readiness-player-ids.stage-v1'
readonly KEMERBET_OWNER_STAGED_PLAYER_IDS_INSTALLING_NAME='.kemerbet-readiness-player-ids.stage-v1.installing'
readonly KEMERBET_OWNER_STAGED_CLAIM_NAME='kemerbet-readiness-cohort-claim.stage-v1'
readonly KEMERBET_OWNER_STAGED_CLAIM_INSTALLING_NAME='.kemerbet-readiness-cohort-claim.stage-v1.installing'
readonly KEMERBET_OWNER_IMPORTED_CLAIM_NAME='kemerbet-readiness-cohort-imported-v1'
readonly KEMERBET_OWNER_IMPORTED_CLAIM_INSTALLING_NAME='.kemerbet-readiness-cohort-imported-v1.installing'
readonly KEMERBET_OWNER_COMPLETED_CLAIM_NAME='kemerbet-readiness-cohort-completed-v1'
readonly KEMERBET_OWNER_COMPLETED_CLAIM_INSTALLING_NAME='.kemerbet-readiness-cohort-completed-v1.installing'
readonly KEMERBET_OWNER_FAILED_CLAIM_NAME='kemerbet-readiness-cohort-failed-v1'
readonly KEMERBET_OWNER_FAILED_CLAIM_INSTALLING_NAME='.kemerbet-readiness-cohort-failed-v1.installing'
readonly KEMERBET_RECOVERY_LATCH_NAME='kemerbet-readiness-recovery-in-progress-or-failed-v1'
readonly KEMERBET_RECOVERY_LATCH_INSTALLING_NAME='.kemerbet-readiness-recovery-in-progress-or-failed-v1.installing'
readonly KEMERBET_RECOVERY_FALLBACK_NAME='recovery-in-progress-or-failed-v1'
readonly KEMERBET_RECOVERY_FALLBACK_INSTALLING_NAME='.recovery-in-progress-or-failed-v1.installing'
readonly KEMERBET_PROFILE_VOLUME="${PROJECT_NAME}_kemerbet_sessions"
readonly KEMERBET_RECHECK_TIMEOUT_SECONDS='300'
readonly KEMERBET_RECHECK_KILL_AFTER_SECONDS='15'
# The trusted proxy performs eight fixed, sequential upstream prefetches with a ten-second
# per-request ceiling before publishing its private application-ready marker. Keep the helper's
# outer deadline strictly above that worst-case startup window and the complete 90-second
# start-period plus 120 one-second application-health retry budget.
readonly KEMERBET_RECHECK_SERVICE_READY_TIMEOUT_SECONDS='240'
readonly STAGING_MUTATION_LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
readonly STAGING_MUTATION_LOCK="$STAGING_MUTATION_LOCK_ROOT/mutation.lock"
readonly EXPIRY_STOP_SERVICE='fetanagent-staging-runtime-expiry-stop.service'
readonly EXPIRY_STOP_TIMER='fetanagent-staging-runtime-expiry-stop.timer'
readonly EXPIRY_STOP_SERVICE_PATH="/etc/systemd/system/$EXPIRY_STOP_SERVICE"
readonly EXPIRY_STOP_TIMER_PATH="/etc/systemd/system/$EXPIRY_STOP_TIMER"
readonly LEGACY_STOPPED_RECEIPT='/var/lib/fetanagent-vm-transition/legacy-stopped-v1'
readonly TRANSITION_RECEIPT='/var/lib/fetanagent-vm-transition/retired-v1'
readonly HELPER_ROTATION_RECEIPT='/var/lib/fetanagent-vm-transition/helper-rotation-v1'
readonly TRANSITION_VERSION='1'
readonly STAGING_DROPLET_ID='590666364'
readonly FRESH_STAGING_DROPLET_ID='593344964'
readonly LEGACY_HELPER_SHA='4007e616b5d0b8b29b9e8f80de6a86485d60e0fb28ad54028cc2f3b1bb080d69'
readonly BASE_HELPER_SHA='e530efcc0781be8d298c0527f1a27bf1b7c97f9e0c9584adc0dd6ced0a7770af'
readonly BASE_REVIEWED_COMMIT='e636de89be179514af3aae3972ee0b086cd8c816'

export PATH="$SAFE_PATH"

die() {
  printf 'staging deploy helper failed: %s\n' "$1" >&2
  exit 1
}

docker_local() {
  env -i \
    PATH="$SAFE_PATH" \
    HOME='/root' \
    DOCKER_HOST="$LOCAL_DOCKER_SOCKET" \
    docker --host "$LOCAL_DOCKER_SOCKET" "$@"
}

validate_commit_and_tag() {
  local commit_sha="$1"
  local image_tag="$2"
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || die 'the commit must be 40 lowercase hexadecimal characters'
  [[ "$image_tag" =~ ^[0-9a-f]{12}$ ]] || die 'the image tag must be 12 lowercase hexadecimal characters'
  [[ "$image_tag" == "${commit_sha:0:12}" ]] || die 'the image tag does not match the commit'
}

require_service_file() {
  local path="$1"
  [[ ! -L "$path" && -f "$path" ]] || die 'a required service file is absent or symbolic'
  [[ "$(stat --format='%u:%g:%a' "$path")" == '10001:10001:400' ]] ||
    die 'a service secret does not have the required ownership and mode'
}

require_root_readable_immutable_file() {
  local path="$1"
  [[ ! -L "$path" && -f "$path" ]] || die 'a required root-managed file is absent or symbolic'
  [[ "$(realpath -- "$path")" == "$path" ]] || die 'a required root-managed file is not canonical'
  [[ "$(stat --format='%U:%G:%a' "$path")" == 'root:root:444' ]] ||
    die 'a required root-managed file does not have the required ownership and mode'
}

require_kemerbet_identity_key_file() {
  local metadata path="$1"
  [[ ! -L "$path" && -f "$path" ]] || die 'the KemerBet identity key is absent or symbolic'
  [[ "$(realpath -- "$path")" == "$path" ]] || die 'the KemerBet identity key is not canonical'
  metadata="$(stat --format='%u:%g:%a' "$path")"
  [[ "$metadata" == '10001:10001:400' || "$metadata" == '0:0:444' ]] ||
    die 'the KemerBet identity key ownership or mode is unsafe'
}

acquire_staging_mutation_lock() {
  local fd_identity path_identity
  command -v flock >/dev/null 2>&1 || die 'the staging mutation lock utility is unavailable'
  [[ ! -L /run && -d /run && "$(realpath -- /run)" == '/run' &&
    "$(stat --format='%U:%G:%a' /run)" == 'root:root:755' ]] ||
    die 'the runtime directory is unsafe for the staging mutation lock'
  if [[ ! -e "$STAGING_MUTATION_LOCK_ROOT" && ! -L "$STAGING_MUTATION_LOCK_ROOT" ]]; then
    (umask 077 && mkdir --mode=0700 -- "$STAGING_MUTATION_LOCK_ROOT") ||
      die 'the staging mutation lock root could not be created'
  fi
  [[ ! -L "$STAGING_MUTATION_LOCK_ROOT" && -d "$STAGING_MUTATION_LOCK_ROOT" &&
    "$(realpath -- "$STAGING_MUTATION_LOCK_ROOT")" == "$STAGING_MUTATION_LOCK_ROOT" &&
    "$(stat --format='%U:%G:%a' "$STAGING_MUTATION_LOCK_ROOT")" == 'root:root:700' ]] ||
    die 'the staging mutation lock root is unsafe'
  if [[ ! -e "$STAGING_MUTATION_LOCK" && ! -L "$STAGING_MUTATION_LOCK" ]]; then
    (set -o noclobber; umask 077; : >"$STAGING_MUTATION_LOCK") 2>/dev/null || true
  fi
  [[ ! -L "$STAGING_MUTATION_LOCK" && -f "$STAGING_MUTATION_LOCK" &&
    "$(realpath -- "$STAGING_MUTATION_LOCK")" == "$STAGING_MUTATION_LOCK" &&
    "$(stat --format='%U:%G:%a:%h' "$STAGING_MUTATION_LOCK")" == 'root:root:600:1' ]] ||
    die 'the staging mutation lock is unsafe'
  exec 9<>"$STAGING_MUTATION_LOCK"
  path_identity="$(stat --format='%u:%g:%a:%h:%d:%i' "$STAGING_MUTATION_LOCK")" ||
    die 'the staging mutation lock path could not be inspected'
  fd_identity="$(stat -L --format='%u:%g:%a:%h:%d:%i' /proc/self/fd/9)" ||
    die 'the opened staging mutation lock could not be inspected'
  [[ "$fd_identity" == '0:0:600:1:'* && "$fd_identity" == "$path_identity" ]] ||
    die 'the opened staging mutation lock does not match its root-managed path'
  flock --exclusive --nonblock 9 || die 'another staging mutation is already active'
  [[ "$(stat --format='%u:%g:%a:%h:%d:%i' "$STAGING_MUTATION_LOCK")" == "$fd_identity" ]] ||
    die 'the staging mutation lock path changed while acquiring the lock'
}

clear_bot_startup_receipt() {
  if [[ ! -e "$BOT_STARTUP_RECEIPT_ROOT" && ! -L "$BOT_STARTUP_RECEIPT_ROOT" ]]; then
    return
  fi
  [[ ! -L "$BOT_STARTUP_RECEIPT_ROOT" && -d "$BOT_STARTUP_RECEIPT_ROOT" ]] ||
    die 'the Telegram startup-receipt root is not a safe directory'
  [[ "$(stat --format='%U:%G:%a' "$BOT_STARTUP_RECEIPT_ROOT")" == 'root:root:700' ]] ||
    die 'the Telegram startup-receipt root ownership or mode is unsafe'
  if [[ -e "$BOT_STARTUP_RECEIPT" || -L "$BOT_STARTUP_RECEIPT" ]]; then
    [[ ! -L "$BOT_STARTUP_RECEIPT" && -f "$BOT_STARTUP_RECEIPT" ]] ||
      die 'the Telegram startup receipt is not a safe regular file'
    [[ "$(stat --format='%U:%G:%a' "$BOT_STARTUP_RECEIPT")" == 'root:root:600' ]] ||
      die 'the Telegram startup receipt ownership or mode is unsafe'
    rm -f -- "$BOT_STARTUP_RECEIPT"
  fi
  rmdir -- "$BOT_STARTUP_RECEIPT_ROOT" ||
    die 'the Telegram startup-receipt root contains unexpected residue'
}

require_immutable_config_file() {
  local path="$1"
  [[ ! -L "$path" && -f "$path" ]] || die 'a required immutable config file is absent or symbolic'
  [[ "$(stat --format='%U:%G:%a' "$path")" == 'root:root:444' ]] ||
    die 'an immutable config file does not have the required ownership and mode'
}

normalize_kemerbet_readiness_binding_publication() {
  local action="${1:-normalize}"
  [[ "$action" == 'normalize' || "$action" == 'inspect' ]] || return 1
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$KEMERBET_READINESS_OUTPUT_ROOT" "$(basename -- "$KEMERBET_READINESS_BINDING")" \
    "$action" <<'PY'
import os
import re
import stat
import sys

UUID = r'[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
BINDING_V1 = re.compile(
    rf'{UUID} hmac-sha256-agent-identity-v1:[0-9a-f]{{64}}\n'
)
BINDING_V2 = re.compile(
    rf'{UUID} hmac-sha256-agent-identity-v1:[0-9a-f]{{64}} '
    r'sha256-provider-authorization-v1:[0-9a-f]{64}\n'
)
BINDING_V3 = re.compile(
    rf'{UUID} hmac-sha256-agent-identity-v1:([0-9a-f]{{64}}) '
    r'hmac-sha256-agent-profile-pin-v3:\1\n'
)
HEX = b'0123456789abcdef'


def binding_v2_prefix_contract():
    contract = []
    for index in range(36):
        if index in (8, 13, 18, 23):
            contract.append(b'-')
        elif index == 14:
            contract.append(b'12345')
        elif index == 19:
            contract.append(b'89ab')
        else:
            contract.append(HEX)
    for byte in b' hmac-sha256-agent-identity-v1:':
        contract.append(bytes((byte,)))
    contract.extend([HEX] * 64)
    for byte in b' sha256-provider-authorization-v1:':
        contract.append(bytes((byte,)))
    contract.extend([HEX] * 64)
    contract.append(b'\n')
    if len(contract) != 230:
        reject()
    return contract


def is_binding_v2_prefix(content):
    contract = binding_v2_prefix_contract()
    return len(content) <= len(contract) and all(
        byte in contract[index] for index, byte in enumerate(content)
    )


def binding_v3_prefix_contract():
    contract = []
    for index in range(36):
        if index in (8, 13, 18, 23):
            contract.append(b'-')
        elif index == 14:
            contract.append(b'12345')
        elif index == 19:
            contract.append(b'89ab')
        else:
            contract.append(HEX)
    for byte in b' hmac-sha256-agent-identity-v1:':
        contract.append(bytes((byte,)))
    contract.extend([HEX] * 64)
    for byte in b' hmac-sha256-agent-profile-pin-v3:':
        contract.append(bytes((byte,)))
    contract.extend([HEX] * 64)
    contract.append(b'\n')
    if len(contract) != 230:
        reject()
    return contract


def is_binding_v3_prefix(content):
    contract = binding_v3_prefix_contract()
    return len(content) <= len(contract) and all(
        byte in contract[index] for index, byte in enumerate(content)
    )


def reject():
    raise RuntimeError()


def exact_mode(value):
    return stat.S_IMODE(value.st_mode)


def read_bounded(directory_fd, name, maximum):
    before = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
    flags = os.O_RDONLY | os.O_CLOEXEC
    if hasattr(os, 'O_NOFOLLOW'):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(name, flags, dir_fd=directory_fd)
    try:
        opened = os.fstat(descriptor)
        chunks = []
        size = 0
        while True:
            chunk = os.read(descriptor, maximum + 1 - size)
            if not chunk:
                break
            size += len(chunk)
            if size > maximum:
                reject()
            chunks.append(chunk)
    finally:
        os.close(descriptor)
    after = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
    if (
        not stat.S_ISREG(before.st_mode)
        or before.st_mode != opened.st_mode
        or before.st_uid != opened.st_uid
        or before.st_gid != opened.st_gid
        or before.st_nlink != opened.st_nlink
        or before.st_size != opened.st_size
        or (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino)
        or before.st_mode != after.st_mode
        or before.st_uid != after.st_uid
        or before.st_gid != after.st_gid
        or before.st_nlink != after.st_nlink
        or before.st_size != after.st_size
        or (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino)
    ):
        reject()
    return before, b''.join(chunks)


try:
    if len(sys.argv) != 4:
        reject()
    root, final_name, action = sys.argv[1:]
    if (
        final_name != 'kemerbet_agent_identity_bindings'
        or action not in {'normalize', 'inspect'}
        or os.path.realpath(root) != root
    ):
        reject()
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC
    if hasattr(os, 'O_NOFOLLOW'):
        flags |= os.O_NOFOLLOW
    root_fd = os.open(root, flags)
    try:
        root_before = os.fstat(root_fd)
        if (
            not stat.S_ISDIR(root_before.st_mode)
            or root_before.st_uid != 10001
            or root_before.st_gid != 10001
            or exact_mode(root_before) != 0o700
        ):
            reject()
        entries = sorted(os.listdir(root_fd))
        temporary_pattern = re.compile(
            rf'\.kemerbet_agent_identity_bindings\.({UUID})\.tmp'
        )
        temporary_names = [name for name in entries if temporary_pattern.fullmatch(name)]
        if len(temporary_names) > 1:
            reject()
        if any(name != final_name and name not in temporary_names for name in entries):
            reject()
        final_present = final_name in entries
        temporary = temporary_names[0] if temporary_names else None
        publication_state = 'empty'
        if final_present:
            final_before, final_content = read_bounded(root_fd, final_name, 230)
            final_contract = None
            final_version = None
            if final_before.st_size == 132:
                final_contract = BINDING_V1
                final_version = 'v1'
            elif final_before.st_size == 230:
                final_text = final_content.decode('ascii', errors='strict')
                if BINDING_V3.fullmatch(final_text) is not None:
                    final_contract = BINDING_V3
                    final_version = 'v3'
                elif BINDING_V2.fullmatch(final_text) is not None:
                    final_contract = BINDING_V2
                    final_version = 'v2'
            if (
                final_before.st_uid != 10001
                or final_before.st_gid != 10001
                or exact_mode(final_before) != 0o600
                or final_before.st_nlink != (2 if temporary else 1)
                or final_contract is None
                or final_contract.fullmatch(final_content.decode('ascii', errors='strict')) is None
            ):
                reject()
            if temporary:
                if final_before.st_size != 230:
                    reject()
                temporary_before, temporary_content = read_bounded(root_fd, temporary, 230)
                if (
                    (temporary_before.st_dev, temporary_before.st_ino) !=
                    (final_before.st_dev, final_before.st_ino)
                    or temporary_before.st_nlink != 2
                    or temporary_content != final_content
                ):
                    reject()
                publication_state = f'{final_version}-hardlink-prefix'
                if action == 'normalize':
                    os.unlink(temporary, dir_fd=root_fd)
                    os.fsync(root_fd)
                    normalized, normalized_content = read_bounded(root_fd, final_name, 230)
                    if (
                        (normalized.st_dev, normalized.st_ino) !=
                        (final_before.st_dev, final_before.st_ino)
                        or normalized.st_nlink != 1
                        or normalized_content != final_content
                    ):
                        reject()
            else:
                publication_state = final_version
        elif temporary:
            temporary_before, temporary_content = read_bounded(root_fd, temporary, 230)
            if (
                temporary_before.st_uid != 10001
                or temporary_before.st_gid != 10001
                or exact_mode(temporary_before) != 0o600
                or temporary_before.st_nlink != 1
                or temporary_before.st_size > 230
            ):
                reject()
            if len(temporary_content) == 230:
                temporary_text = temporary_content.decode('ascii', errors='strict')
                if BINDING_V3.fullmatch(temporary_text) is not None:
                    temporary_version = 'v3'
                elif BINDING_V2.fullmatch(temporary_text) is not None:
                    temporary_version = 'v2'
                else:
                    reject()
            else:
                v2_prefix = is_binding_v2_prefix(temporary_content)
                v3_prefix = is_binding_v3_prefix(temporary_content)
                if not v2_prefix and not v3_prefix:
                    reject()
                temporary_version = 'v3' if v3_prefix and not v2_prefix else 'v2'
            publication_state = (
                f'{temporary_version}-temp-complete-prefix'
                if len(temporary_content) == 230
                else f'{temporary_version}-temp-prefix'
            )
            if action == 'normalize' and len(temporary_content) == 230:
                sync_flags = os.O_RDONLY | os.O_CLOEXEC
                if hasattr(os, 'O_NOFOLLOW'):
                    sync_flags |= os.O_NOFOLLOW
                sync_descriptor = os.open(temporary, sync_flags, dir_fd=root_fd)
                try:
                    synchronized = os.fstat(sync_descriptor)
                    if (
                        (synchronized.st_dev, synchronized.st_ino) !=
                        (temporary_before.st_dev, temporary_before.st_ino)
                        or synchronized.st_mode != temporary_before.st_mode
                        or synchronized.st_uid != temporary_before.st_uid
                        or synchronized.st_gid != temporary_before.st_gid
                        or synchronized.st_nlink != temporary_before.st_nlink
                        or synchronized.st_size != temporary_before.st_size
                    ):
                        reject()
                    os.fsync(sync_descriptor)
                finally:
                    os.close(sync_descriptor)
                synchronized_named, synchronized_content = read_bounded(root_fd, temporary, 230)
                if (
                    (synchronized_named.st_dev, synchronized_named.st_ino) !=
                    (temporary_before.st_dev, temporary_before.st_ino)
                    or synchronized_content != temporary_content
                ):
                    reject()
                os.link(
                    temporary,
                    final_name,
                    src_dir_fd=root_fd,
                    dst_dir_fd=root_fd,
                    follow_symlinks=False,
                )
                os.unlink(temporary, dir_fd=root_fd)
                os.fsync(root_fd)
                normalized, normalized_content = read_bounded(root_fd, final_name, 230)
                if (
                    (normalized.st_dev, normalized.st_ino) !=
                    (temporary_before.st_dev, temporary_before.st_ino)
                    or normalized.st_nlink != 1
                    or normalized_content != temporary_content
                ):
                    reject()
            elif action == 'normalize':
                os.unlink(temporary, dir_fd=root_fd)
                os.fsync(root_fd)
        final_entries = sorted(os.listdir(root_fd))
        if action == 'normalize':
            if final_entries not in ([], [final_name]):
                reject()
        elif final_entries != entries:
            reject()
        root_after = os.fstat(root_fd)
        if (
            root_after.st_mode != root_before.st_mode
            or root_after.st_uid != root_before.st_uid
            or root_after.st_gid != root_before.st_gid
            or (root_after.st_dev, root_after.st_ino) != (root_before.st_dev, root_before.st_ino)
        ):
            reject()
        if action == 'inspect':
            sys.stdout.write(publication_state + '\n')
    finally:
        os.close(root_fd)
except Exception:
    raise SystemExit(1)
PY
}

require_kemerbet_readiness_output_directory() {
  local entry
  [[ ! -L "$KEMERBET_READINESS_OUTPUT_ROOT" && -d "$KEMERBET_READINESS_OUTPUT_ROOT" ]] ||
    die 'the KemerBet readiness output root is absent or symbolic'
  [[ "$(stat --format='%u:%g:%a' "$KEMERBET_READINESS_OUTPUT_ROOT")" == '10001:10001:700' ]] ||
    die 'the KemerBet readiness output root ownership or mode is unsafe'
  [[ "$(realpath -- "$KEMERBET_READINESS_OUTPUT_ROOT")" == "$KEMERBET_READINESS_OUTPUT_ROOT" ]] ||
    die 'the KemerBet readiness output root is not canonical'
  normalize_kemerbet_readiness_binding_publication ||
    die 'the KemerBet readiness binding publication residue is unsafe'
  while IFS= read -r entry; do
    [[ "$entry" == 'kemerbet_agent_identity_bindings' ]] ||
      die 'the KemerBet readiness output root contains unexpected residue'
  done < <(find -P "$KEMERBET_READINESS_OUTPUT_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n')
  if [[ -e "$KEMERBET_READINESS_BINDING" || -L "$KEMERBET_READINESS_BINDING" ]]; then
    [[ ! -L "$KEMERBET_READINESS_BINDING" && -f "$KEMERBET_READINESS_BINDING" ]] ||
      die 'the KemerBet readiness binding is not a safe regular file'
    [[ "$(realpath -- "$KEMERBET_READINESS_BINDING")" == "$KEMERBET_READINESS_BINDING" &&
      "$(stat --format='%u:%g:%a:%h:%s' "$KEMERBET_READINESS_BINDING")" == \
        '10001:10001:600:1:230' &&
      "$(wc -l <"$KEMERBET_READINESS_BINDING")" == '1' ]] ||
      die 'the KemerBet readiness binding metadata or shape is unsafe'
    LC_ALL=C grep -Eq \
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12} hmac-sha256-agent-identity-v1:[0-9a-f]{64} (sha256-provider-authorization-v1|hmac-sha256-agent-profile-pin-v3):[0-9a-f]{64}$' \
      "$KEMERBET_READINESS_BINDING" ||
      die 'the KemerBet readiness binding contract is invalid'
  fi
}

require_kemerbet_v3_binding_content() {
  local path="$1"
  env -i PATH="$SAFE_PATH" python3 -I - "$path" <<'PY'
import os
import re
import stat
import sys

PATTERN = re.compile(
    rb'([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}) '
    rb'hmac-sha256-agent-identity-v1:([0-9a-f]{64}) '
    rb'hmac-sha256-agent-profile-pin-v3:\2\n'
)


def reject():
    raise RuntimeError()


try:
    if len(sys.argv) != 2 or os.path.realpath(sys.argv[1]) != sys.argv[1]:
        reject()
    path = sys.argv[1]
    before = os.stat(path, follow_symlinks=False)
    if not stat.S_ISREG(before.st_mode) or before.st_size != 230:
        reject()
    flags = os.O_RDONLY | os.O_CLOEXEC
    if hasattr(os, 'O_NOFOLLOW'):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags)
    try:
        opened = os.fstat(descriptor)
        data = bytearray()
        while len(data) <= 230:
            chunk = os.read(descriptor, 231 - len(data))
            if not chunk:
                break
            data.extend(chunk)
        after = os.fstat(descriptor)
    finally:
        os.close(descriptor)
    path_after = os.stat(path, follow_symlinks=False)
    identity = lambda value: (
        value.st_dev,
        value.st_ino,
        value.st_uid,
        value.st_gid,
        value.st_mode,
        value.st_nlink,
        value.st_size,
        value.st_mtime_ns,
    )
    if (
        identity(before) != identity(opened)
        or identity(opened) != identity(after)
        or identity(after) != identity(path_after)
        or len(data) != 230
        or PATTERN.fullmatch(bytes(data)) is None
    ):
        reject()
except Exception:
    raise SystemExit(1)
PY
}

KEMERBET_V1_RETIREMENT_RELEASE=''
KEMERBET_V1_RETIREMENT_HELPER_DEV_INO=''
KEMERBET_V1_RETIREMENT_HELPER_SHA256=''
KEMERBET_V1_RETIREMENT_LEGACY_DEV_INO=''
KEMERBET_V1_RETIREMENT_LEGACY_SHA256=''
KEMERBET_V1_RETIREMENT_IDENTITY_KEY_DEV_INO=''
KEMERBET_V1_RETIREMENT_IDENTITY_KEY_SHA256=''
KEMERBET_V1_RETIREMENT_CLAIM_SHA256=''
KEMERBET_V1_RETIREMENT_PLAYER_DEV_INO=''
KEMERBET_V1_RETIREMENT_PLAYER_SHA256=''
KEMERBET_V1_RETIREMENT_CLAIM_DEV_INO=''
KEMERBET_V1_RETIREMENT_RELEASE_ASSET_SHA256=''
KEMERBET_V1_RETIREMENT_CONTINUITY_STATE=''
KEMERBET_V1_RETIREMENT_RECOVERY_PREFLIGHT_STATE=''

publish_kemerbet_v1_retirement_artifact() {
  local destination="$1" mode="$2" root temporary="${1}.installing"
  shift 2
  case "$destination" in
    "$KEMERBET_V1_RETIREMENT_INTENT"|"$KEMERBET_V1_RETIREMENT_COMPLETION")
      root="$KEMERBET_V1_RETIREMENT_ROOT"
      ;;
    "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING/intent-v1")
      root="$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING"
      ;;
    *) return 1 ;;
  esac
  [[ "$mode" == '0600' && $# -ge 1 ]] || return 1
  if [[ -e "$destination" || -L "$destination" ]]; then
    [[ ! -L "$destination" && -f "$destination" &&
      "$(stat --format='%U:%G:%a:%h' "$destination")" =~ ^root:root:600:(1|2)$ ]] || return 1
    cmp -s -- "$destination" <(printf '%s\n' "$@") || return 1
    if [[ -e "$temporary" || -L "$temporary" ]]; then
      [[ ! -L "$temporary" && -f "$temporary" &&
        "$(stat --format='%d:%i' "$temporary")" == "$(stat --format='%d:%i' "$destination")" ]] ||
        return 1
      rm -f -- "$temporary" || return 1
      sync -f "$root" || return 1
    fi
    [[ "$(stat --format='%h' "$destination")" == '1' ]] || return 1
    return 0
  fi
  if [[ -e "$temporary" || -L "$temporary" ]]; then
    [[ ! -L "$temporary" && -f "$temporary" &&
      "$(stat --format='%U:%G:%a:%h' "$temporary")" == 'root:root:600:1' &&
      "$(stat --format='%s' "$temporary")" -le 4096 ]] || return 1
    rm -f -- "$temporary" || return 1
    sync -f "$root" || return 1
  fi
  (set -o noclobber; umask 077; printf '%s\n' "$@" >"$temporary") || return 1
  chown root:root "$temporary" || return 1
  chmod "$mode" "$temporary" || return 1
  sync -f "$temporary" || return 1
  ln -- "$temporary" "$destination" || return 1
  rm -f -- "$temporary" || return 1
  sync -f "$root" || return 1
  [[ ! -L "$destination" && -f "$destination" &&
    "$(stat --format='%U:%G:%a:%h' "$destination")" == 'root:root:600:1' ]] || return 1
  cmp -s -- "$destination" <(printf '%s\n' "$@")
}

publish_kemerbet_v1_retirement_archive() {
  local source="$1" expected_digest="$2"
  local destination="${3:-$KEMERBET_V1_RETIREMENT_ARCHIVE}" root temporary
  case "$destination" in
    "$KEMERBET_V1_RETIREMENT_ARCHIVE") root="$KEMERBET_V1_RETIREMENT_ROOT" ;;
    "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING/archive-v1")
      root="$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING"
      ;;
    *) return 1 ;;
  esac
  temporary="${destination}.installing"
  [[ "$expected_digest" =~ ^[0-9a-f]{64}$ ]] || return 1
  if [[ -e "$destination" || -L "$destination" ]]; then
    [[ ! -L "$destination" && -f "$destination" &&
      "$(stat --format='%U:%G:%a:%h:%s' "$destination")" =~ ^root:root:400:(1|2):132$ &&
      "$(sha256sum -- "$destination" | awk '{print $1}')" == "$expected_digest" ]] || return 1
    if [[ -e "$temporary" || -L "$temporary" ]]; then
      [[ ! -L "$temporary" && -f "$temporary" &&
        "$(stat --format='%d:%i' "$temporary")" == "$(stat --format='%d:%i' "$destination")" ]] ||
        return 1
      rm -f -- "$temporary" || return 1
      sync -f "$root" || return 1
    fi
    [[ "$(stat --format='%h' "$destination")" == '1' ]] || return 1
    return 0
  fi
  [[ ! -L "$source" && -f "$source" &&
    "$(sha256sum -- "$source" | awk '{print $1}')" == "$expected_digest" ]] || return 1
  if [[ -e "$temporary" || -L "$temporary" ]]; then
    [[ ! -L "$temporary" && -f "$temporary" &&
      "$(stat --format='%U:%G:%a:%h' "$temporary")" == 'root:root:400:1' &&
      "$(stat --format='%s' "$temporary")" -le 132 ]] || return 1
    rm -f -- "$temporary" || return 1
    sync -f "$root" || return 1
  fi
  install -o root -g root -m 0400 -T -- "$source" "$temporary" || return 1
  sync -f "$temporary" || return 1
  [[ "$(stat --format='%U:%G:%a:%h:%s' "$temporary")" == 'root:root:400:1:132' &&
    "$(sha256sum -- "$temporary" | awk '{print $1}')" == "$expected_digest" ]] || return 1
  ln -- "$temporary" "$destination" || return 1
  rm -f -- "$temporary" || return 1
  sync -f "$root" || return 1
  [[ ! -L "$destination" && -f "$destination" &&
    "$(stat --format='%U:%G:%a:%h:%s' "$destination")" == 'root:root:400:1:132' &&
    "$(sha256sum -- "$destination" | awk '{print $1}')" == "$expected_digest" ]]
}

publish_kemerbet_v1_retirement_root() {
  local parent source_name target_name
  [[ ! -e "$KEMERBET_V1_RETIREMENT_ROOT" && ! -L "$KEMERBET_V1_RETIREMENT_ROOT" &&
    ! -L "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" &&
    -d "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" &&
    "$(realpath -- "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING")" == \
      "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" &&
    "$(stat --format='%U:%G:%a' "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING")" == \
      'root:root:700' ]] || return 1
  [[ "$(find -P "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" -mindepth 1 -maxdepth 1 \
      -printf '%f\n' | LC_ALL=C sort)" == $'archive-v1\nintent-v1' ]] || return 1
  read_kemerbet_v1_retirement_intent_metadata \
    "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" \
    "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING/intent-v1" || return 1
  require_kemerbet_v1_retirement_archive \
    "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING/archive-v1" || return 1
  sync -f "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING/intent-v1" || return 1
  sync -f "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING/archive-v1" || return 1
  sync -f "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" || return 1
  parent="$(dirname -- "$KEMERBET_V1_RETIREMENT_ROOT")" || return 1
  source_name="$(basename -- "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING")" || return 1
  target_name="$(basename -- "$KEMERBET_V1_RETIREMENT_ROOT")" || return 1
  env -i PATH="$SAFE_PATH" python3 -I - "$parent" "$source_name" "$target_name" <<'PY'
import ctypes
import errno
import os
import stat
import sys


def reject():
    raise RuntimeError()


try:
    if len(sys.argv) != 4:
        reject()
    parent, source_name, target_name = sys.argv[1:]
    if '/' in source_name or '/' in target_name or not source_name or not target_name:
        reject()
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC
    if hasattr(os, 'O_NOFOLLOW'):
        flags |= os.O_NOFOLLOW
    parent_fd = os.open(parent, flags)
    try:
        parent_stat = os.fstat(parent_fd)
        if not stat.S_ISDIR(parent_stat.st_mode) or parent_stat.st_uid != 0 or parent_stat.st_gid != 0:
            reject()
        source_before = os.stat(source_name, dir_fd=parent_fd, follow_symlinks=False)
        if (
            not stat.S_ISDIR(source_before.st_mode)
            or source_before.st_uid != 0
            or source_before.st_gid != 0
            or stat.S_IMODE(source_before.st_mode) != 0o700
        ):
            reject()
        try:
            os.stat(target_name, dir_fd=parent_fd, follow_symlinks=False)
            reject()
        except FileNotFoundError:
            pass
        libc = ctypes.CDLL(None, use_errno=True)
        renameat2 = libc.renameat2
        renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        renameat2.restype = ctypes.c_int
        if renameat2(parent_fd, os.fsencode(source_name), parent_fd, os.fsencode(target_name), 1) != 0:
            error = ctypes.get_errno()
            if error in (errno.EEXIST, errno.ENOTEMPTY):
                reject()
            raise OSError(error, os.strerror(error))
        os.fsync(parent_fd)
        target_after = os.stat(target_name, dir_fd=parent_fd, follow_symlinks=False)
        if (
            (target_after.st_dev, target_after.st_ino) !=
            (source_before.st_dev, source_before.st_ino)
            or target_after.st_mode != source_before.st_mode
            or target_after.st_uid != source_before.st_uid
            or target_after.st_gid != source_before.st_gid
        ):
            reject()
        try:
            os.stat(source_name, dir_fd=parent_fd, follow_symlinks=False)
            reject()
        except FileNotFoundError:
            pass
    finally:
        os.close(parent_fd)
except Exception:
    raise SystemExit(1)
PY
  [[ ! -e "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" &&
    ! -L "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" &&
    ! -L "$KEMERBET_V1_RETIREMENT_ROOT" && -d "$KEMERBET_V1_RETIREMENT_ROOT" &&
    "$(realpath -- "$KEMERBET_V1_RETIREMENT_ROOT")" == "$KEMERBET_V1_RETIREMENT_ROOT" &&
    "$(stat --format='%U:%G:%a' "$KEMERBET_V1_RETIREMENT_ROOT")" == 'root:root:700' ]]
}

read_kemerbet_v1_retirement_intent_metadata() {
  local root="${1:-$KEMERBET_V1_RETIREMENT_ROOT}"
  local intent="${2:-$KEMERBET_V1_RETIREMENT_INTENT}"
  local -a lines=()
  [[ ( "$root" == "$KEMERBET_V1_RETIREMENT_ROOT" &&
      "$intent" == "$KEMERBET_V1_RETIREMENT_INTENT" ) ||
    ( "$root" == "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" &&
      "$intent" == "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING/intent-v1" ) ]] || return 1
  [[ ! -L "$root" && -d "$root" &&
    "$(realpath -- "$root")" == "$root" &&
    "$(stat --format='%U:%G:%a' "$root")" == 'root:root:700' ]] || return 1
  [[ ! -L "$intent" && -f "$intent" &&
    "$(realpath -- "$intent")" == "$intent" &&
    "$(stat --format='%U:%G:%a:%h' "$intent")" =~ ^root:root:600:(1|2)$ &&
    "$(stat --format='%s' "$intent")" -le 4096 ]] ||
    return 1
  if [[ "$(stat --format='%h' "$intent")" == '2' ]]; then
    [[ "$root" == "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" &&
      ! -L "${intent}.installing" && -f "${intent}.installing" &&
      "$(stat --format='%d:%i' "${intent}.installing")" == \
        "$(stat --format='%d:%i' "$intent")" ]] || return 1
  fi
  mapfile -t lines <"$intent" || return 1
  [[ "${#lines[@]}" -eq 14 &&
    "${lines[0]}" == 'contract=fetanagent-kemerbet-readiness-binding-v1-retirement-v1' &&
    "${lines[1]}" == 'state=retirement-authorized' &&
    "${lines[2]}" =~ ^release=[0-9a-f]{40}$ &&
    "${lines[3]}" =~ ^helper_dev_ino=[0-9]+:[0-9]+$ &&
    "${lines[4]}" =~ ^helper_sha256=[0-9a-f]{64}$ &&
    "${lines[5]}" =~ ^legacy_binding_dev_ino=[0-9]+:[0-9]+$ &&
    "${lines[6]}" =~ ^legacy_binding_sha256=[0-9a-f]{64}$ &&
    "${lines[7]}" =~ ^identity_hmac_key_dev_ino=[0-9]+:[0-9]+$ &&
    "${lines[8]}" =~ ^identity_hmac_key_sha256=[0-9a-f]{64}$ &&
    "${lines[9]}" =~ ^claim_sha256=[0-9a-f]{64}$ &&
    "${lines[10]}" =~ ^owner_stage_player_ids_dev_ino=[0-9]+:[0-9]+$ &&
    "${lines[11]}" =~ ^owner_stage_player_ids_sha256=[0-9a-f]{64}$ &&
    "${lines[12]}" =~ ^owner_stage_claim_dev_ino=[0-9]+:[0-9]+$ &&
    "${lines[13]}" =~ ^release_asset_sha256=[0-9a-f]{64}$ ]] || return 1
  KEMERBET_V1_RETIREMENT_RELEASE="${lines[2]#release=}"
  KEMERBET_V1_RETIREMENT_HELPER_DEV_INO="${lines[3]#helper_dev_ino=}"
  KEMERBET_V1_RETIREMENT_HELPER_SHA256="${lines[4]#helper_sha256=}"
  KEMERBET_V1_RETIREMENT_LEGACY_DEV_INO="${lines[5]#legacy_binding_dev_ino=}"
  KEMERBET_V1_RETIREMENT_LEGACY_SHA256="${lines[6]#legacy_binding_sha256=}"
  KEMERBET_V1_RETIREMENT_IDENTITY_KEY_DEV_INO="${lines[7]#identity_hmac_key_dev_ino=}"
  KEMERBET_V1_RETIREMENT_IDENTITY_KEY_SHA256="${lines[8]#identity_hmac_key_sha256=}"
  KEMERBET_V1_RETIREMENT_CLAIM_SHA256="${lines[9]#claim_sha256=}"
  KEMERBET_V1_RETIREMENT_PLAYER_DEV_INO="${lines[10]#owner_stage_player_ids_dev_ino=}"
  KEMERBET_V1_RETIREMENT_PLAYER_SHA256="${lines[11]#owner_stage_player_ids_sha256=}"
  KEMERBET_V1_RETIREMENT_CLAIM_DEV_INO="${lines[12]#owner_stage_claim_dev_ino=}"
  KEMERBET_V1_RETIREMENT_RELEASE_ASSET_SHA256="${lines[13]#release_asset_sha256=}"
  cmp -s -- "$intent" <(printf '%s\n' \
    'contract=fetanagent-kemerbet-readiness-binding-v1-retirement-v1' \
    'state=retirement-authorized' \
    "release=$KEMERBET_V1_RETIREMENT_RELEASE" \
    "helper_dev_ino=$KEMERBET_V1_RETIREMENT_HELPER_DEV_INO" \
    "helper_sha256=$KEMERBET_V1_RETIREMENT_HELPER_SHA256" \
    "legacy_binding_dev_ino=$KEMERBET_V1_RETIREMENT_LEGACY_DEV_INO" \
    "legacy_binding_sha256=$KEMERBET_V1_RETIREMENT_LEGACY_SHA256" \
    "identity_hmac_key_dev_ino=$KEMERBET_V1_RETIREMENT_IDENTITY_KEY_DEV_INO" \
    "identity_hmac_key_sha256=$KEMERBET_V1_RETIREMENT_IDENTITY_KEY_SHA256" \
    "claim_sha256=$KEMERBET_V1_RETIREMENT_CLAIM_SHA256" \
    "owner_stage_player_ids_dev_ino=$KEMERBET_V1_RETIREMENT_PLAYER_DEV_INO" \
    "owner_stage_player_ids_sha256=$KEMERBET_V1_RETIREMENT_PLAYER_SHA256" \
    "owner_stage_claim_dev_ino=$KEMERBET_V1_RETIREMENT_CLAIM_DEV_INO" \
    "release_asset_sha256=$KEMERBET_V1_RETIREMENT_RELEASE_ASSET_SHA256")
}

require_kemerbet_v1_retirement_current_context() {
  local commit_sha="$1" claim_sha256 release_asset_sha256
  local root="${2:-$KEMERBET_V1_RETIREMENT_ROOT}"
  local intent="${3:-$KEMERBET_V1_RETIREMENT_INTENT}"
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || return 1
  read_kemerbet_v1_retirement_intent_metadata "$root" "$intent" || return 1
  [[ "$KEMERBET_V1_RETIREMENT_RELEASE" == "$commit_sha" ]] || return 1
  inspect_owner_staged_kemerbet_cohort_for_retirement_context || return 1
  claim_sha256="$(printf '%s\n' "$KEMERBET_RECHECK_OWNER_CLAIM_ID" | sha256sum | awk '{print $1}')" ||
    return 1
  require_kemerbet_identity_key_file "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" || return 1
  release_asset_sha256="$(kemerbet_v1_retirement_release_asset_digest "$commit_sha")" ||
    return 1
  [[ "$KEMERBET_V1_RETIREMENT_HELPER_DEV_INO" == "$(stat --format='%d:%i' "$HELPER_PATH")" &&
    "$KEMERBET_V1_RETIREMENT_HELPER_SHA256" == "$(sha256sum -- "$HELPER_PATH" | awk '{print $1}')" &&
    "$KEMERBET_V1_RETIREMENT_IDENTITY_KEY_DEV_INO" == \
      "$(stat --format='%d:%i' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")" &&
    "$KEMERBET_V1_RETIREMENT_IDENTITY_KEY_SHA256" == \
      "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" &&
    "$KEMERBET_V1_RETIREMENT_CLAIM_SHA256" == "$claim_sha256" &&
    "$KEMERBET_V1_RETIREMENT_PLAYER_DEV_INO" == \
      "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" &&
    "$KEMERBET_V1_RETIREMENT_PLAYER_SHA256" == "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" &&
    "$KEMERBET_V1_RETIREMENT_CLAIM_DEV_INO" == \
      "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" &&
    "$KEMERBET_V1_RETIREMENT_RELEASE_ASSET_SHA256" == "$release_asset_sha256" ]] ||
    return 1
  require_owner_kemerbet_failed_marker_read_only "$KEMERBET_RECHECK_OWNER_CLAIM_ID"
}

inspect_kemerbet_v1_retirement_intent() {
  local commit_sha="$1" entries
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || return 1
  entries="$(find -P "$KEMERBET_V1_RETIREMENT_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" ||
    return 1
  [[ "$entries" == 'archive-v1'$'\n''intent-v1' ||
    "$entries" == 'archive-v1'$'\n''completed-v1'$'\n''intent-v1' ||
    "$entries" == 'completed-v1'$'\n''intent-v1' ]] || return 1
  require_kemerbet_v1_retirement_current_context "$commit_sha"
}

require_kemerbet_v1_retirement_archive() {
  local archive="${1:-$KEMERBET_V1_RETIREMENT_ARCHIVE}"
  [[ "$archive" == "$KEMERBET_V1_RETIREMENT_ARCHIVE" ||
    "$archive" == "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING/archive-v1" ]] || return 1
  [[ ! -L "$archive" && -f "$archive" &&
    "$(realpath -- "$archive")" == "$archive" &&
    "$(stat --format='%U:%G:%a:%h:%s' "$archive")" =~ ^root:root:400:(1|2):132$ &&
    "$(wc -l <"$archive")" == '1' &&
    "$(sha256sum -- "$archive" | awk '{print $1}')" == \
      "$KEMERBET_V1_RETIREMENT_LEGACY_SHA256" ]] || return 1
  if [[ "$(stat --format='%h' "$archive")" == '2' ]]; then
    [[ "$archive" == "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING/archive-v1" &&
      ! -L "${archive}.installing" && -f "${archive}.installing" &&
      "$(stat --format='%d:%i' "${archive}.installing")" == \
        "$(stat --format='%d:%i' "$archive")" ]] || return 1
  fi
  LC_ALL=C grep -Eq \
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12} hmac-sha256-agent-identity-v1:[0-9a-f]{64}$' \
    "$archive"
}

require_kemerbet_v1_retired_awaiting_v2() {
  local commit_sha="$1" entries
  inspect_kemerbet_v1_retirement_intent "$commit_sha" || return 1
  entries="$(find -P "$KEMERBET_V1_RETIREMENT_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" ||
    return 1
  [[ "$entries" == 'archive-v1'$'\n''intent-v1' &&
    ! -e "$KEMERBET_READINESS_BINDING" && ! -L "$KEMERBET_READINESS_BINDING" ]] || return 1
  require_kemerbet_v1_retirement_archive || return 1
  require_owner_kemerbet_failed_marker_read_only "$KEMERBET_RECHECK_OWNER_CLAIM_ID"
}

require_kemerbet_v1_retirement_consume_prefix() {
  local commit_sha="$1" after before digest entries
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || return 1
  inspect_kemerbet_v1_retirement_intent "$commit_sha" || return 1
  entries="$(find -P "$KEMERBET_V1_RETIREMENT_ROOT" -mindepth 1 -maxdepth 1 \
    -printf '%f\n' | LC_ALL=C sort)" || return 1
  [[ "$entries" == 'archive-v1'$'\n''intent-v1' ]] || return 1
  require_kemerbet_v1_retirement_archive || return 1
  [[ ! -L "$KEMERBET_READINESS_BINDING" && -f "$KEMERBET_READINESS_BINDING" &&
    "$(realpath -- "$KEMERBET_READINESS_BINDING")" == "$KEMERBET_READINESS_BINDING" ]] ||
    return 1
  before="$(stat --format='%d:%i:%u:%g:%a:%h:%s:%Y' "$KEMERBET_READINESS_BINDING")" ||
    return 1
  [[ "$before" == "$KEMERBET_V1_RETIREMENT_LEGACY_DEV_INO:10001:10001:600:1:132:"* &&
    "$(wc -l <"$KEMERBET_READINESS_BINDING")" == '1' ]] || return 1
  LC_ALL=C grep -Eq \
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12} hmac-sha256-agent-identity-v1:[0-9a-f]{64}$' \
    "$KEMERBET_READINESS_BINDING" || return 1
  digest="$(sha256sum -- "$KEMERBET_READINESS_BINDING" | awk '{print $1}')" || return 1
  after="$(stat --format='%d:%i:%u:%g:%a:%h:%s:%Y' "$KEMERBET_READINESS_BINDING")" ||
    return 1
  [[ "$digest" == "$KEMERBET_V1_RETIREMENT_LEGACY_SHA256" &&
    "$after" == "$before" ]] || return 1
  owner_kemerbet_cohort_marker require-failed "$KEMERBET_RECHECK_OWNER_CLAIM_ID"
}

require_kemerbet_v1_retirement_v2_binding_projection() {
  local account_id binding_line identity_fingerprint links="${1:-1}"
  local provider_authorization_digest residue
  [[ "$links" == '1' || "$links" == '2' ]] || return 1
  [[ ! -L "$KEMERBET_READINESS_BINDING" && -f "$KEMERBET_READINESS_BINDING" &&
    "$(realpath -- "$KEMERBET_READINESS_BINDING")" == "$KEMERBET_READINESS_BINDING" &&
    "$(stat --format='%u:%g:%a:%h:%s' "$KEMERBET_READINESS_BINDING")" == \
      "10001:10001:600:$links:230" &&
    "$(wc -l <"$KEMERBET_READINESS_BINDING")" == '1' ]] || return 1
  LC_ALL=C grep -Eq \
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12} hmac-sha256-agent-identity-v1:[0-9a-f]{64} sha256-provider-authorization-v1:[0-9a-f]{64}$' \
    "$KEMERBET_READINESS_BINDING" || return 1
  binding_line="$(<"$KEMERBET_READINESS_BINDING")"
  IFS=' ' read -r account_id identity_fingerprint provider_authorization_digest residue \
    <<<"$binding_line"
  [[ -n "$account_id" && -n "$identity_fingerprint" &&
    -n "$provider_authorization_digest" && -z "$residue" &&
    "$(printf '%s %s\n' "$account_id" "$identity_fingerprint" | sha256sum | awk '{print $1}')" == \
      "$KEMERBET_V1_RETIREMENT_LEGACY_SHA256" ]]
}

require_kemerbet_v1_retirement_v2_temporary_projection() {
  local account_id after before binding_line binding_sha256 entries identity_fingerprint
  local provider_authorization_digest residue temporary temporary_name
  entries="$(find -P "$KEMERBET_READINESS_OUTPUT_ROOT" -mindepth 1 -maxdepth 1 \
    -printf '%f\n' | LC_ALL=C sort)" || return 1
  [[ "$entries" =~ ^\.kemerbet_agent_identity_bindings\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$ &&
    ! -e "$KEMERBET_READINESS_BINDING" && ! -L "$KEMERBET_READINESS_BINDING" ]] ||
    return 1
  temporary_name="$entries"
  temporary="$KEMERBET_READINESS_OUTPUT_ROOT/$temporary_name"
  [[ ! -L "$temporary" && -f "$temporary" && "$(realpath -- "$temporary")" == "$temporary" ]] ||
    return 1
  before="$(stat --format='%d:%i:%u:%g:%a:%h:%s:%Y' "$temporary")" || return 1
  [[ "$before" =~ ^[0-9]+:[0-9]+:10001:10001:600:1:230:[0-9]+$ &&
    "$(wc -l <"$temporary")" == '1' ]] ||
    return 1
  LC_ALL=C grep -Eq \
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12} hmac-sha256-agent-identity-v1:[0-9a-f]{64} sha256-provider-authorization-v1:[0-9a-f]{64}$' \
    "$temporary" || return 1
  binding_line="$(<"$temporary")"
  binding_sha256="$(sha256sum -- "$temporary" | awk '{print $1}')" || return 1
  IFS=' ' read -r account_id identity_fingerprint provider_authorization_digest residue \
    <<<"$binding_line"
  [[ -n "$account_id" && -n "$identity_fingerprint" &&
    -n "$provider_authorization_digest" && -z "$residue" &&
    "$(printf '%s %s\n' "$account_id" "$identity_fingerprint" | sha256sum | awk '{print $1}')" == \
      "$KEMERBET_V1_RETIREMENT_LEGACY_SHA256" ]] || return 1
  after="$(stat --format='%d:%i:%u:%g:%a:%h:%s:%Y' "$temporary")" || return 1
  [[ "$after" == "$before" &&
    "$(sha256sum -- "$temporary" | awk '{print $1}')" == "$binding_sha256" ]]
}

require_kemerbet_v1_retirement_seal_finalization_prefix() {
  local commit_sha="$1" entries installing
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || return 1
  entries="$(find -P "$KEMERBET_V1_RETIREMENT_ROOT" -mindepth 1 -maxdepth 1 \
    -printf '%f\n' | LC_ALL=C sort)" || return 1
  installing="${KEMERBET_V1_RETIREMENT_COMPLETION}.installing"
  case "$entries" in
    $'archive-v1\nintent-v1') ;;
    $'archive-v1\ncompleted-v1.installing\nintent-v1')
      [[ ! -L "$installing" && -f "$installing" &&
        "$(stat --format='%U:%G:%a:%h' "$installing")" == 'root:root:600:1' &&
        "$(stat --format='%s' "$installing")" -le 4096 ]] || return 1
      ;;
    $'archive-v1\ncompleted-v1\ncompleted-v1.installing\nintent-v1')
      [[ ! -L "$installing" && -f "$installing" &&
        ! -L "$KEMERBET_V1_RETIREMENT_COMPLETION" &&
        -f "$KEMERBET_V1_RETIREMENT_COMPLETION" &&
        "$(stat --format='%d:%i' "$installing")" == \
          "$(stat --format='%d:%i' "$KEMERBET_V1_RETIREMENT_COMPLETION")" &&
        "$(stat --format='%U:%G:%a:%h' "$installing")" == 'root:root:600:2' &&
        "$(stat --format='%U:%G:%a:%h' "$KEMERBET_V1_RETIREMENT_COMPLETION")" == \
          'root:root:600:2' ]] || return 1
      ;;
    *) return 1 ;;
  esac
  require_kemerbet_v1_retirement_current_context "$commit_sha" || return 1
  require_kemerbet_v1_retirement_archive || return 1
  require_kemerbet_v1_retirement_v2_binding_projection
}

require_kemerbet_v1_retirement_recovery_topology() {
  local commit_sha="$1" entries
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || return 1
  entries="$(find -P "$KEMERBET_V1_RETIREMENT_ROOT" -mindepth 1 -maxdepth 1 \
    -printf '%f\n' | LC_ALL=C sort)" || return 1
  case "$entries" in
    $'archive-v1\nintent-v1')
      require_kemerbet_v1_retired_awaiting_v2 "$commit_sha"
      ;;
    $'completed-v1\nintent-v1')
      require_kemerbet_v1_retirement_current_context "$commit_sha" &&
        require_kemerbet_v1_retirement_completed_continuity &&
        [[ "$KEMERBET_V1_RETIREMENT_CONTINUITY_STATE" == 'resealed-awaiting-recheck' ]]
      ;;
    *) return 1 ;;
  esac
}

require_kemerbet_readiness_output_directory_read_only() {
  local expected_state="$1" entries
  [[ "$expected_state" == 'empty' || "$expected_state" == 'v2' ]] || return 1
  [[ ! -L "$KEMERBET_READINESS_OUTPUT_ROOT" &&
    -d "$KEMERBET_READINESS_OUTPUT_ROOT" &&
    "$(realpath -- "$KEMERBET_READINESS_OUTPUT_ROOT")" == \
      "$KEMERBET_READINESS_OUTPUT_ROOT" &&
    "$(stat --format='%u:%g:%a' "$KEMERBET_READINESS_OUTPUT_ROOT")" == \
      '10001:10001:700' ]] || return 1
  entries="$(find -P "$KEMERBET_READINESS_OUTPUT_ROOT" -mindepth 1 -maxdepth 1 \
    -printf '%f\n' | LC_ALL=C sort)" || return 1
  case "$expected_state" in
    empty)
      [[ -z "$entries" &&
        ! -e "$KEMERBET_READINESS_BINDING" && ! -L "$KEMERBET_READINESS_BINDING" ]]
      ;;
    v2)
      [[ "$entries" == 'kemerbet_agent_identity_bindings' ]] || return 1
      require_kemerbet_v1_retirement_v2_binding_projection
      ;;
  esac
}

require_kemerbet_v1_retirement_recovery_ready_topology() {
  local commit_sha="$1" entries publication_state
  KEMERBET_V1_RETIREMENT_RECOVERY_PREFLIGHT_STATE=''
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ &&
    ! -e "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" &&
    ! -L "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" &&
    ! -L "$KEMERBET_V1_RETIREMENT_ROOT" &&
    -d "$KEMERBET_V1_RETIREMENT_ROOT" ]] || return 1
  publication_state="$(normalize_kemerbet_readiness_binding_publication inspect)" || return 1
  [[ "$publication_state" =~ ^(empty|v1|v2|v2-temp-prefix|v2-temp-complete-prefix|v2-hardlink-prefix)$ ]] ||
    return 1
  entries="$(find -P "$KEMERBET_V1_RETIREMENT_ROOT" -mindepth 1 -maxdepth 1 \
    -printf '%f\n' | LC_ALL=C sort)" || return 1
  case "$entries" in
    $'archive-v1\nintent-v1')
      if [[ "$publication_state" == 'empty' ]]; then
        require_kemerbet_v1_retired_awaiting_v2 "$commit_sha" || return 1
        require_kemerbet_readiness_output_directory_read_only empty || return 1
        KEMERBET_V1_RETIREMENT_RECOVERY_PREFLIGHT_STATE='clean'
      elif [[ "$publication_state" == 'v2-temp-prefix' ]]; then
        require_kemerbet_v1_retirement_current_context "$commit_sha" || return 1
        require_kemerbet_v1_retirement_archive || return 1
        [[ ! -e "$KEMERBET_READINESS_BINDING" &&
          ! -L "$KEMERBET_READINESS_BINDING" ]] || return 1
        KEMERBET_V1_RETIREMENT_RECOVERY_PREFLIGHT_STATE='safe-to-reset'
      elif [[ "$publication_state" == 'v2-temp-complete-prefix' ]]; then
        require_kemerbet_v1_retirement_current_context "$commit_sha" || return 1
        require_kemerbet_v1_retirement_archive || return 1
        require_kemerbet_v1_retirement_v2_temporary_projection || return 1
        KEMERBET_V1_RETIREMENT_RECOVERY_PREFLIGHT_STATE='safe-to-reset'
      elif [[ "$publication_state" == 'v2-hardlink-prefix' ]]; then
        require_kemerbet_v1_retirement_current_context "$commit_sha" || return 1
        require_kemerbet_v1_retirement_archive || return 1
        require_kemerbet_v1_retirement_v2_binding_projection 2 || return 1
        KEMERBET_V1_RETIREMENT_RECOVERY_PREFLIGHT_STATE='safe-to-reset'
      elif [[ "$publication_state" == 'v2' ]]; then
        require_kemerbet_v1_retirement_seal_finalization_prefix "$commit_sha" || return 1
        require_kemerbet_readiness_output_directory_read_only v2 || return 1
        KEMERBET_V1_RETIREMENT_RECOVERY_PREFLIGHT_STATE='safe-to-reset'
      else
        return 1
      fi
      ;;
    $'archive-v1\ncompleted-v1.installing\nintent-v1')
      [[ "$publication_state" == 'v2' ]] || return 1
      require_kemerbet_v1_retirement_seal_finalization_prefix "$commit_sha" || return 1
      require_kemerbet_readiness_output_directory_read_only v2 || return 1
      KEMERBET_V1_RETIREMENT_RECOVERY_PREFLIGHT_STATE='safe-to-reset'
      ;;
    $'archive-v1\ncompleted-v1\nintent-v1'|\
      $'archive-v1\ncompleted-v1\ncompleted-v1.installing\nintent-v1'|\
      $'completed-v1\nintent-v1')
      [[ "$publication_state" == 'v2' ]] || return 1
      require_kemerbet_v1_retirement_current_context "$commit_sha" || return 1
      require_kemerbet_v1_retirement_completed_continuity || return 1
      [[ "$KEMERBET_V1_RETIREMENT_CONTINUITY_STATE" == \
        'resealed-awaiting-recheck' ]] || return 1
      require_kemerbet_readiness_output_directory_read_only v2 || return 1
      if [[ "$entries" == $'completed-v1\nintent-v1' ]]; then
        KEMERBET_V1_RETIREMENT_RECOVERY_PREFLIGHT_STATE='clean'
      else
        KEMERBET_V1_RETIREMENT_RECOVERY_PREFLIGHT_STATE='safe-to-reset'
      fi
      ;;
    *) return 1 ;;
  esac
  [[ "$KEMERBET_V1_RETIREMENT_RECOVERY_PREFLIGHT_STATE" =~ ^(clean|safe-to-reset)$ ]]
}

require_kemerbet_v1_retirement_recovery_ready() {
  local commit_sha="$1" asset_sha256 helper_sha256 helper_stat observed_state
  local input_state journal_state receipt_state target_state topology_state
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || return 1
  read_kemerbet_v1_retirement_intent_metadata || return 1
  [[ "$KEMERBET_V1_RETIREMENT_RELEASE" == "$commit_sha" ]] || return 1
  helper_stat="$(stat --format='%d:%i:%u:%g:%a:%h:%s:%Y' "$HELPER_PATH")" || return 1
  helper_sha256="$(sha256sum -- "$HELPER_PATH" | awk '{print $1}')" || return 1
  [[ "$helper_stat" == "$KEMERBET_V1_RETIREMENT_HELPER_DEV_INO:0:0:755:1:"* &&
    "$helper_sha256" == "$KEMERBET_V1_RETIREMENT_HELPER_SHA256" ]] || return 1
  require_kemerbet_v1_retirement_current_context "$commit_sha" || return 1
  require_kemerbet_v1_retirement_recovery_ready_topology "$commit_sha" || return 1
  topology_state="$KEMERBET_V1_RETIREMENT_RECOVERY_PREFLIGHT_STATE"
  require_kemerbet_v1_retirement_safe_reset_boundary || return 1
  asset_sha256="$(kemerbet_v1_retirement_release_asset_digest "$commit_sha")" || return 1
  [[ "$asset_sha256" == "$KEMERBET_V1_RETIREMENT_RELEASE_ASSET_SHA256" ]] || return 1
  target_state="$(kemerbet_v1_retirement_secret_bundle classify-reset-targets -)" || return 1
  receipt_state="$(classify_kemerbet_v1_retirement_bot_receipt_reset_state)" || return 1
  input_state="$(classify_kemerbet_v1_retirement_input_reset_state "$commit_sha")" || return 1
  journal_state="$(classify_kemerbet_v1_retirement_journal_reset_state "$commit_sha")" || return 1
  [[ "$target_state" =~ ^(absent|present)$ &&
    "$receipt_state" =~ ^(absent|present)$ &&
    "$input_state" =~ ^(absent|present)$ &&
    "$journal_state" =~ ^(absent|present)$ ]] || return 1
  observed_state="$topology_state|$target_state|$receipt_state|$input_state|$journal_state"
  if [[ "$observed_state" == 'clean|absent|absent|absent|absent' ]]; then
    KEMERBET_V1_RETIREMENT_RECOVERY_PREFLIGHT_STATE='clean'
  else
    KEMERBET_V1_RETIREMENT_RECOVERY_PREFLIGHT_STATE='safe-to-reset'
  fi
  require_kemerbet_v1_retirement_current_context "$commit_sha" || return 1
  require_kemerbet_v1_retirement_recovery_ready_topology "$commit_sha" || return 1
  [[ "$KEMERBET_V1_RETIREMENT_RECOVERY_PREFLIGHT_STATE" == "$topology_state" ]] || return 1
  require_kemerbet_v1_retirement_safe_reset_boundary || return 1
  [[ "$(kemerbet_v1_retirement_release_asset_digest "$commit_sha")" == \
      "$asset_sha256" &&
    "$(kemerbet_v1_retirement_secret_bundle classify-reset-targets -)" == "$target_state" &&
    "$(classify_kemerbet_v1_retirement_bot_receipt_reset_state)" == "$receipt_state" &&
    "$(classify_kemerbet_v1_retirement_input_reset_state "$commit_sha")" == "$input_state" &&
    "$(classify_kemerbet_v1_retirement_journal_reset_state "$commit_sha")" == "$journal_state" &&
    "$(stat --format='%d:%i:%u:%g:%a:%h:%s:%Y' "$HELPER_PATH")" == "$helper_stat" &&
    "$(sha256sum -- "$HELPER_PATH" | awk '{print $1}')" == "$helper_sha256" ]] || return 1
  if [[ "$observed_state" == 'clean|absent|absent|absent|absent' ]]; then
    KEMERBET_V1_RETIREMENT_RECOVERY_PREFLIGHT_STATE='clean'
  else
    KEMERBET_V1_RETIREMENT_RECOVERY_PREFLIGHT_STATE='safe-to-reset'
  fi
}

finalize_kemerbet_v1_retirement_after_v2_seal() {
  local commit_sha="$1" entries v1_projection_sha256 v2_binding_dev_ino v2_binding_sha256
  local account_id identity_fingerprint provider_authorization_digest residue
  local binding_line v2_binding_stat
  [[ -e "$KEMERBET_V1_RETIREMENT_ROOT" || -L "$KEMERBET_V1_RETIREMENT_ROOT" ]] || return 0
  if [[ -e "${KEMERBET_V1_RETIREMENT_COMPLETION}.installing" ||
    -L "${KEMERBET_V1_RETIREMENT_COMPLETION}.installing" ]]; then
    if [[ -e "$KEMERBET_V1_RETIREMENT_COMPLETION" ||
      -L "$KEMERBET_V1_RETIREMENT_COMPLETION" ]]; then
      [[ ! -L "${KEMERBET_V1_RETIREMENT_COMPLETION}.installing" &&
        -f "${KEMERBET_V1_RETIREMENT_COMPLETION}.installing" &&
        "$(stat --format='%d:%i' "${KEMERBET_V1_RETIREMENT_COMPLETION}.installing")" == \
          "$(stat --format='%d:%i' "$KEMERBET_V1_RETIREMENT_COMPLETION")" ]] || return 1
    else
      [[ ! -L "${KEMERBET_V1_RETIREMENT_COMPLETION}.installing" &&
        -f "${KEMERBET_V1_RETIREMENT_COMPLETION}.installing" &&
        "$(stat --format='%U:%G:%a:%h' "${KEMERBET_V1_RETIREMENT_COMPLETION}.installing")" == \
          'root:root:600:1' &&
        "$(stat --format='%s' "${KEMERBET_V1_RETIREMENT_COMPLETION}.installing")" -le 4096 ]] || return 1
    fi
    rm -f -- "${KEMERBET_V1_RETIREMENT_COMPLETION}.installing" || return 1
    sync -f "$KEMERBET_V1_RETIREMENT_ROOT" || return 1
  fi
  inspect_owner_staged_kemerbet_cohort_for_retirement_context || return 1
  inspect_kemerbet_v1_retirement_intent "$commit_sha" || return 1
  require_owner_kemerbet_failed_marker_read_only "$KEMERBET_RECHECK_OWNER_CLAIM_ID" || return 1
  [[ ! -L "$KEMERBET_READINESS_BINDING" && -f "$KEMERBET_READINESS_BINDING" &&
    "$(stat --format='%u:%g:%a:%h:%s' "$KEMERBET_READINESS_BINDING")" == \
      '10001:10001:600:1:230' &&
    "$(wc -l <"$KEMERBET_READINESS_BINDING")" == '1' ]] || return 1
  LC_ALL=C grep -Eq \
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12} hmac-sha256-agent-identity-v1:[0-9a-f]{64} sha256-provider-authorization-v1:[0-9a-f]{64}$' \
    "$KEMERBET_READINESS_BINDING" || return 1
  binding_line="$(<"$KEMERBET_READINESS_BINDING")"
  IFS=' ' read -r account_id identity_fingerprint provider_authorization_digest residue \
    <<<"$binding_line"
  [[ -n "$account_id" && -n "$identity_fingerprint" &&
    -n "$provider_authorization_digest" && -z "$residue" ]] || return 1
  v1_projection_sha256="$(printf '%s %s\n' "$account_id" "$identity_fingerprint" | sha256sum | awk '{print $1}')" ||
    return 1
  [[ "$v1_projection_sha256" == "$KEMERBET_V1_RETIREMENT_LEGACY_SHA256" ]] || return 1
  v2_binding_stat="$(stat --format='%d:%i:%u:%g:%a:%h:%s:%Y' "$KEMERBET_READINESS_BINDING")" ||
    return 1
  v2_binding_dev_ino="$(stat --format='%d:%i' "$KEMERBET_READINESS_BINDING")" || return 1
  v2_binding_sha256="$(sha256sum -- "$KEMERBET_READINESS_BINDING" | awk '{print $1}')" || return 1
  [[ "$v2_binding_dev_ino" =~ ^[0-9]+:[0-9]+$ && "$v2_binding_sha256" =~ ^[0-9a-f]{64}$ ]] ||
    return 1
  publish_kemerbet_v1_retirement_artifact "$KEMERBET_V1_RETIREMENT_COMPLETION" 0600 \
    'contract=fetanagent-kemerbet-readiness-binding-v1-retirement-v1' \
    'state=resealed-v2' \
    "release=$commit_sha" \
    "helper_dev_ino=$KEMERBET_V1_RETIREMENT_HELPER_DEV_INO" \
    "helper_sha256=$KEMERBET_V1_RETIREMENT_HELPER_SHA256" \
    "legacy_binding_dev_ino=$KEMERBET_V1_RETIREMENT_LEGACY_DEV_INO" \
    "legacy_binding_sha256=$KEMERBET_V1_RETIREMENT_LEGACY_SHA256" \
    "identity_hmac_key_dev_ino=$KEMERBET_V1_RETIREMENT_IDENTITY_KEY_DEV_INO" \
    "identity_hmac_key_sha256=$KEMERBET_V1_RETIREMENT_IDENTITY_KEY_SHA256" \
    "claim_sha256=$KEMERBET_V1_RETIREMENT_CLAIM_SHA256" \
    "owner_stage_player_ids_dev_ino=$KEMERBET_V1_RETIREMENT_PLAYER_DEV_INO" \
    "owner_stage_player_ids_sha256=$KEMERBET_V1_RETIREMENT_PLAYER_SHA256" \
    "owner_stage_claim_dev_ino=$KEMERBET_V1_RETIREMENT_CLAIM_DEV_INO" \
    "release_asset_sha256=$KEMERBET_V1_RETIREMENT_RELEASE_ASSET_SHA256" \
    "v2_binding_dev_ino=$v2_binding_dev_ino" \
    "v2_binding_sha256=$v2_binding_sha256" || return 1
  inspect_owner_staged_kemerbet_cohort_for_retirement_context || return 1
  inspect_kemerbet_v1_retirement_intent "$commit_sha" || return 1
  require_owner_kemerbet_failed_marker_read_only "$KEMERBET_RECHECK_OWNER_CLAIM_ID" || return 1
  [[ "$(stat --format='%d:%i:%u:%g:%a:%h:%s:%Y' "$KEMERBET_READINESS_BINDING")" == \
      "$v2_binding_stat" &&
    "$(sha256sum -- "$KEMERBET_READINESS_BINDING" | awk '{print $1}')" == \
      "$v2_binding_sha256" ]] || return 1
  binding_line="$(<"$KEMERBET_READINESS_BINDING")"
  IFS=' ' read -r account_id identity_fingerprint provider_authorization_digest residue \
    <<<"$binding_line"
  [[ -n "$account_id" && -n "$identity_fingerprint" &&
    -n "$provider_authorization_digest" && -z "$residue" &&
    "$(printf '%s %s\n' "$account_id" "$identity_fingerprint" | sha256sum | awk '{print $1}')" == \
      "$KEMERBET_V1_RETIREMENT_LEGACY_SHA256" ]] || return 1
  if [[ -e "$KEMERBET_V1_RETIREMENT_ARCHIVE" || -L "$KEMERBET_V1_RETIREMENT_ARCHIVE" ]]; then
    require_kemerbet_v1_retirement_archive || return 1
    rm -f -- "$KEMERBET_V1_RETIREMENT_ARCHIVE" || return 1
    sync -f "$KEMERBET_V1_RETIREMENT_ROOT" || return 1
  fi
  entries="$(find -P "$KEMERBET_V1_RETIREMENT_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" ||
    return 1
  [[ "$entries" == 'completed-v1'$'\n''intent-v1' ]]
}

retire_kemerbet_v1_binding_for_v2_reseal() {
  local commit_sha="$1" expected_legacy_sha256="$2" expected_release_asset_sha256="${3:-}"
  local claim_sha256 entries legacy_dev_ino
  local helper_dev_ino helper_sha256 identity_key_dev_ino identity_key_sha256 source_digest source_stat
  local retirement_parent retirement_parent_mode
  local -a intent_lines=()
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ && "$expected_legacy_sha256" =~ ^[0-9a-f]{64}$ &&
    "$expected_release_asset_sha256" =~ ^[0-9a-f]{64}$ ]] ||
    return 1
  [[ "$(kemerbet_v1_retirement_release_asset_digest "$commit_sha")" == \
    "$expected_release_asset_sha256" ]] || return 1
  [[ ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    ! -e "$KEMERBET_RECHECK_RECEIPT_ROOT" && ! -L "$KEMERBET_RECHECK_RECEIPT_ROOT" &&
    ! -e "$KEMERBET_RECHECK_CANDIDATE_ROOT" && ! -L "$KEMERBET_RECHECK_CANDIDATE_ROOT" &&
    ! -e "$KEMERBET_AGENT_IDENTITY_BINDINGS" && ! -L "$KEMERBET_AGENT_IDENTITY_BINDINGS" &&
    ! -e "$KEMERBET_READINESS_PLAYER_IDS" && ! -L "$KEMERBET_READINESS_PLAYER_IDS" ]] ||
    return 1
  require_kemerbet_recheck_transients_absent || return 1
  [[ -z "$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter 'label=com.docker.compose.service=kemerbet-session-provision')" ]] || return 1
  require_kemerbet_profile_volume_holders '' || return 1
  helper_dev_ino="$(stat --format='%d:%i' "$HELPER_PATH")" || return 1
  helper_sha256="$(sha256sum -- "$HELPER_PATH" | awk '{print $1}')" || return 1
  [[ "$helper_dev_ino" =~ ^[0-9]+:[0-9]+$ && "$helper_sha256" =~ ^[0-9a-f]{64}$ ]] ||
    return 1
  require_kemerbet_identity_key_file "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" || return 1
  [[ "$(stat --format='%h' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")" == '1' ]] || return 1
  identity_key_dev_ino="$(stat --format='%d:%i' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")" || return 1
  identity_key_sha256="$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" ||
    return 1
  [[ "$identity_key_dev_ino" =~ ^[0-9]+:[0-9]+$ && "$identity_key_sha256" =~ ^[0-9a-f]{64}$ ]] ||
    return 1
  inspect_owner_staged_kemerbet_cohort_for_retirement_context || return 1
  require_owner_kemerbet_failed_marker_read_only "$KEMERBET_RECHECK_OWNER_CLAIM_ID" || return 1
  for entries in \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_IMPORTED_CLAIM_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_IMPORTED_CLAIM_INSTALLING_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_COMPLETED_CLAIM_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_COMPLETED_CLAIM_INSTALLING_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_FAILED_CLAIM_INSTALLING_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME"; do
    [[ ! -e "$entries" && ! -L "$entries" ]] || return 1
  done
  require_legacy_owner_kemerbet_receipt_paths_absent || return 1
  claim_sha256="$(printf '%s\n' "$KEMERBET_RECHECK_OWNER_CLAIM_ID" | sha256sum | awk '{print $1}')" ||
    return 1

  [[ ! -L "$KEMERBET_READINESS_OUTPUT_ROOT" && -d "$KEMERBET_READINESS_OUTPUT_ROOT" &&
    "$(realpath -- "$KEMERBET_READINESS_OUTPUT_ROOT")" == "$KEMERBET_READINESS_OUTPUT_ROOT" &&
    "$(stat --format='%u:%g:%a' "$KEMERBET_READINESS_OUTPUT_ROOT")" == '10001:10001:700' ]] ||
    return 1
  entries="$(find -P "$KEMERBET_READINESS_OUTPUT_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n')" ||
    return 1
  [[ -z "$entries" || "$entries" == 'kemerbet_agent_identity_bindings' ]] || return 1

  retirement_parent="$(dirname -- "$KEMERBET_V1_RETIREMENT_ROOT")" || return 1
  [[ ! -L "$retirement_parent" && -d "$retirement_parent" &&
    "$(realpath -- "$retirement_parent")" == "$retirement_parent" &&
    "$(stat --format='%U:%G' "$retirement_parent")" == 'root:root' ]] || return 1
  retirement_parent_mode="$(stat --format='%a' "$retirement_parent")" || return 1
  [[ "$retirement_parent_mode" =~ ^[0-7]{3,4}$ ]] || return 1
  (( (8#$retirement_parent_mode & 8#022) == 0 )) || return 1

  if [[ -e "$KEMERBET_V1_RETIREMENT_ROOT" || -L "$KEMERBET_V1_RETIREMENT_ROOT" ]]; then
    [[ ! -e "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" &&
      ! -L "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" &&
      ! -L "$KEMERBET_V1_RETIREMENT_ROOT" && -d "$KEMERBET_V1_RETIREMENT_ROOT" &&
      "$(realpath -- "$KEMERBET_V1_RETIREMENT_ROOT")" == "$KEMERBET_V1_RETIREMENT_ROOT" &&
      "$(stat --format='%U:%G:%a' "$KEMERBET_V1_RETIREMENT_ROOT")" == 'root:root:700' ]] ||
      return 1
    [[ ! -L "$KEMERBET_V1_RETIREMENT_INTENT" && -f "$KEMERBET_V1_RETIREMENT_INTENT" &&
      "$(stat --format='%U:%G:%a:%h' "$KEMERBET_V1_RETIREMENT_INTENT")" == 'root:root:600:1' ]] ||
      return 1
    mapfile -t intent_lines <"$KEMERBET_V1_RETIREMENT_INTENT" || return 1
    [[ "${#intent_lines[@]}" -eq 14 &&
      "${intent_lines[2]}" == "release=$commit_sha" &&
      "${intent_lines[3]}" == "helper_dev_ino=$helper_dev_ino" &&
      "${intent_lines[4]}" == "helper_sha256=$helper_sha256" &&
      "${intent_lines[5]}" =~ ^legacy_binding_dev_ino=[0-9]+:[0-9]+$ &&
      "${intent_lines[6]}" == "legacy_binding_sha256=$expected_legacy_sha256" &&
      "${intent_lines[7]}" == "identity_hmac_key_dev_ino=$identity_key_dev_ino" &&
      "${intent_lines[8]}" == "identity_hmac_key_sha256=$identity_key_sha256" &&
      "${intent_lines[13]}" == \
        "release_asset_sha256=$expected_release_asset_sha256" ]] || return 1
    legacy_dev_ino="${intent_lines[5]#legacy_binding_dev_ino=}"
  else
    [[ ! -L "$KEMERBET_READINESS_BINDING" && -f "$KEMERBET_READINESS_BINDING" &&
      "$(realpath -- "$KEMERBET_READINESS_BINDING")" == "$KEMERBET_READINESS_BINDING" &&
      "$(stat --format='%u:%g:%a:%h:%s' "$KEMERBET_READINESS_BINDING")" == \
        '10001:10001:600:1:132' &&
      "$(wc -l <"$KEMERBET_READINESS_BINDING")" == '1' ]] || return 1
    LC_ALL=C grep -Eq \
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12} hmac-sha256-agent-identity-v1:[0-9a-f]{64}$' \
      "$KEMERBET_READINESS_BINDING" || return 1
    source_digest="$(sha256sum -- "$KEMERBET_READINESS_BINDING" | awk '{print $1}')" || return 1
    [[ "$source_digest" == "$expected_legacy_sha256" ]] || return 1
    legacy_dev_ino="$(stat --format='%d:%i' "$KEMERBET_READINESS_BINDING")" || return 1
    intent_lines=(
      'contract=fetanagent-kemerbet-readiness-binding-v1-retirement-v1'
      'state=retirement-authorized'
      "release=$commit_sha"
      "helper_dev_ino=$helper_dev_ino"
      "helper_sha256=$helper_sha256"
      "legacy_binding_dev_ino=$legacy_dev_ino"
      "legacy_binding_sha256=$expected_legacy_sha256"
      "identity_hmac_key_dev_ino=$identity_key_dev_ino"
      "identity_hmac_key_sha256=$identity_key_sha256"
      "claim_sha256=$claim_sha256"
      "owner_stage_player_ids_dev_ino=$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO"
      "owner_stage_player_ids_sha256=$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"
      "owner_stage_claim_dev_ino=$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO"
      "release_asset_sha256=$expected_release_asset_sha256"
    )
    if [[ ! -e "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" &&
      ! -L "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" ]]; then
      install -d -o root -g root -m 0700 "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" ||
        return 1
      sync -f "$retirement_parent" || return 1
    fi
    [[ ! -L "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" &&
      -d "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" &&
      "$(realpath -- "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING")" == \
        "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" &&
      "$(stat --format='%U:%G:%a' "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING")" == \
        'root:root:700' ]] || return 1
    entries="$(find -P "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" \
      -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" || return 1
    case "$entries" in
      ''|'intent-v1.installing'|'intent-v1'|$'intent-v1\nintent-v1.installing'|\
        $'archive-v1.installing\nintent-v1'|$'archive-v1\nintent-v1'|\
        $'archive-v1\narchive-v1.installing\nintent-v1') ;;
      *) return 1 ;;
    esac
    publish_kemerbet_v1_retirement_artifact \
      "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING/intent-v1" 0600 \
      "${intent_lines[@]}" || return 1
    publish_kemerbet_v1_retirement_archive \
      "$KEMERBET_READINESS_BINDING" "$expected_legacy_sha256" \
      "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING/archive-v1" || return 1
    require_kemerbet_v1_retirement_current_context "$commit_sha" \
      "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" \
      "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING/intent-v1" || return 1
    require_kemerbet_v1_retirement_archive \
      "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING/archive-v1" || return 1
    source_stat="$(stat --format='%d:%i:%u:%g:%a:%h:%s:%Y' "$KEMERBET_READINESS_BINDING")" ||
      return 1
    [[ "$source_stat" == "$legacy_dev_ino:10001:10001:600:1:132:"* &&
      "$(sha256sum -- "$KEMERBET_READINESS_BINDING" | awk '{print $1}')" == \
        "$expected_legacy_sha256" ]] || return 1
    publish_kemerbet_v1_retirement_root || return 1
  fi

  inspect_kemerbet_v1_retirement_intent "$commit_sha" || return 1
  [[ "$KEMERBET_V1_RETIREMENT_LEGACY_DEV_INO" == "$legacy_dev_ino" &&
    "$KEMERBET_V1_RETIREMENT_LEGACY_SHA256" == "$expected_legacy_sha256" &&
    "$KEMERBET_V1_RETIREMENT_RELEASE_ASSET_SHA256" == \
      "$expected_release_asset_sha256" ]] || return 1

  if [[ -e "$KEMERBET_READINESS_BINDING" || -L "$KEMERBET_READINESS_BINDING" ]]; then
    if [[ "$(stat --format='%s' "$KEMERBET_READINESS_BINDING" 2>/dev/null)" == '230' ]]; then
      finalize_kemerbet_v1_retirement_after_v2_seal "$commit_sha"
      return $?
    fi
    source_stat="$(stat --format='%d:%i:%u:%g:%a:%h:%s:%Y' "$KEMERBET_READINESS_BINDING")" ||
      return 1
    [[ "$source_stat" == "$legacy_dev_ino:10001:10001:600:1:132:"* &&
      "$(sha256sum -- "$KEMERBET_READINESS_BINDING" | awk '{print $1}')" == \
        "$expected_legacy_sha256" ]] || return 1
    require_kemerbet_v1_retirement_archive || return 1
    [[ "$(stat --format='%d:%i:%u:%g:%a:%h:%s:%Y' "$KEMERBET_READINESS_BINDING")" == \
        "$source_stat" &&
      "$(sha256sum -- "$KEMERBET_READINESS_BINDING" | awk '{print $1}')" == \
        "$expected_legacy_sha256" ]] || return 1
    consume_exact_one_use_kemerbet_file \
      "$KEMERBET_READINESS_BINDING" "$legacy_dev_ino" "$expected_legacy_sha256" || return 1
  fi
  inspect_owner_staged_kemerbet_cohort || return 1
  require_kemerbet_v1_retired_awaiting_v2 "$commit_sha"
}

require_kemerbet_v1_retirement_completed_continuity() {
  local account_id active_binding binding_line binding_residue entries identity_fingerprint
  local provider_authorization_digest receipt_entries v1_projection_sha256 v2_binding_dev_ino
  local completion_installing v2_binding_sha256
  local -a completion_lines=() receipt_lines=()
  KEMERBET_V1_RETIREMENT_CONTINUITY_STATE=''
  entries="$(find -P "$KEMERBET_V1_RETIREMENT_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" ||
    return 1
  case "$entries" in
    $'completed-v1\nintent-v1') ;;
    $'archive-v1\ncompleted-v1\nintent-v1') ;;
    $'archive-v1\ncompleted-v1\ncompleted-v1.installing\nintent-v1') ;;
    *) return 1 ;;
  esac
  read_kemerbet_v1_retirement_intent_metadata || return 1
  if [[ "$entries" == archive-v1$'\n'* ]]; then
    require_kemerbet_v1_retirement_archive || return 1
  fi
  completion_installing="${KEMERBET_V1_RETIREMENT_COMPLETION}.installing"
  [[ ! -L "$KEMERBET_V1_RETIREMENT_COMPLETION" &&
    -f "$KEMERBET_V1_RETIREMENT_COMPLETION" &&
    "$(realpath -- "$KEMERBET_V1_RETIREMENT_COMPLETION")" == \
      "$KEMERBET_V1_RETIREMENT_COMPLETION" &&
    "$(stat --format='%U:%G:%a:%h' "$KEMERBET_V1_RETIREMENT_COMPLETION")" =~ \
      ^root:root:600:(1|2)$ &&
    "$(stat --format='%s' "$KEMERBET_V1_RETIREMENT_COMPLETION")" -le 4096 ]] || return 1
  if [[ "$(stat --format='%h' "$KEMERBET_V1_RETIREMENT_COMPLETION")" == '2' ]]; then
    [[ "$entries" == $'archive-v1\ncompleted-v1\ncompleted-v1.installing\nintent-v1' &&
      ! -L "$completion_installing" && -f "$completion_installing" &&
      "$(stat --format='%d:%i' "$completion_installing")" == \
        "$(stat --format='%d:%i' "$KEMERBET_V1_RETIREMENT_COMPLETION")" &&
      "$(stat --format='%U:%G:%a:%h' "$completion_installing")" == \
        'root:root:600:2' ]] || return 1
  else
    [[ "$entries" != *'completed-v1.installing'* ]] || return 1
  fi
  mapfile -t completion_lines <"$KEMERBET_V1_RETIREMENT_COMPLETION" || return 1
  [[ "${#completion_lines[@]}" -eq 16 &&
    "${completion_lines[0]}" == \
      'contract=fetanagent-kemerbet-readiness-binding-v1-retirement-v1' &&
    "${completion_lines[1]}" == 'state=resealed-v2' &&
    "${completion_lines[2]}" == "release=$KEMERBET_V1_RETIREMENT_RELEASE" &&
    "${completion_lines[3]}" == "helper_dev_ino=$KEMERBET_V1_RETIREMENT_HELPER_DEV_INO" &&
    "${completion_lines[4]}" == "helper_sha256=$KEMERBET_V1_RETIREMENT_HELPER_SHA256" &&
    "${completion_lines[5]}" == \
      "legacy_binding_dev_ino=$KEMERBET_V1_RETIREMENT_LEGACY_DEV_INO" &&
    "${completion_lines[6]}" == \
      "legacy_binding_sha256=$KEMERBET_V1_RETIREMENT_LEGACY_SHA256" &&
    "${completion_lines[7]}" == \
      "identity_hmac_key_dev_ino=$KEMERBET_V1_RETIREMENT_IDENTITY_KEY_DEV_INO" &&
    "${completion_lines[8]}" == \
      "identity_hmac_key_sha256=$KEMERBET_V1_RETIREMENT_IDENTITY_KEY_SHA256" &&
    "${completion_lines[9]}" == "claim_sha256=$KEMERBET_V1_RETIREMENT_CLAIM_SHA256" &&
    "${completion_lines[10]}" == \
      "owner_stage_player_ids_dev_ino=$KEMERBET_V1_RETIREMENT_PLAYER_DEV_INO" &&
    "${completion_lines[11]}" == \
      "owner_stage_player_ids_sha256=$KEMERBET_V1_RETIREMENT_PLAYER_SHA256" &&
    "${completion_lines[12]}" == \
      "owner_stage_claim_dev_ino=$KEMERBET_V1_RETIREMENT_CLAIM_DEV_INO" &&
    "${completion_lines[13]}" == \
      "release_asset_sha256=$KEMERBET_V1_RETIREMENT_RELEASE_ASSET_SHA256" &&
    "${completion_lines[14]}" =~ ^v2_binding_dev_ino=[0-9]+:[0-9]+$ &&
    "${completion_lines[15]}" =~ ^v2_binding_sha256=[0-9a-f]{64}$ ]] || return 1
  v2_binding_dev_ino="${completion_lines[14]#v2_binding_dev_ino=}"
  v2_binding_sha256="${completion_lines[15]#v2_binding_sha256=}"
  cmp -s -- "$KEMERBET_V1_RETIREMENT_COMPLETION" <(printf '%s\n' \
    'contract=fetanagent-kemerbet-readiness-binding-v1-retirement-v1' \
    'state=resealed-v2' \
    "release=$KEMERBET_V1_RETIREMENT_RELEASE" \
    "helper_dev_ino=$KEMERBET_V1_RETIREMENT_HELPER_DEV_INO" \
    "helper_sha256=$KEMERBET_V1_RETIREMENT_HELPER_SHA256" \
    "legacy_binding_dev_ino=$KEMERBET_V1_RETIREMENT_LEGACY_DEV_INO" \
    "legacy_binding_sha256=$KEMERBET_V1_RETIREMENT_LEGACY_SHA256" \
    "identity_hmac_key_dev_ino=$KEMERBET_V1_RETIREMENT_IDENTITY_KEY_DEV_INO" \
    "identity_hmac_key_sha256=$KEMERBET_V1_RETIREMENT_IDENTITY_KEY_SHA256" \
    "claim_sha256=$KEMERBET_V1_RETIREMENT_CLAIM_SHA256" \
    "owner_stage_player_ids_dev_ino=$KEMERBET_V1_RETIREMENT_PLAYER_DEV_INO" \
    "owner_stage_player_ids_sha256=$KEMERBET_V1_RETIREMENT_PLAYER_SHA256" \
    "owner_stage_claim_dev_ino=$KEMERBET_V1_RETIREMENT_CLAIM_DEV_INO" \
    "release_asset_sha256=$KEMERBET_V1_RETIREMENT_RELEASE_ASSET_SHA256" \
    "v2_binding_dev_ino=$v2_binding_dev_ino" \
    "v2_binding_sha256=$v2_binding_sha256") || return 1

  [[ ! -L "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" &&
    -f "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" &&
    "$(realpath -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")" == \
      "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" &&
    "$(stat --format='%u:%g:%a:%h:%d:%i' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")" =~ \
      ^(10001:10001:400|0:0:444):1:${KEMERBET_V1_RETIREMENT_IDENTITY_KEY_DEV_INO}$ &&
    "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" == \
      "$KEMERBET_V1_RETIREMENT_IDENTITY_KEY_SHA256" ]] || return 1

  if [[ -e "$KEMERBET_READINESS_BINDING" || -L "$KEMERBET_READINESS_BINDING" ]]; then
    [[ ! -e "$KEMERBET_AGENT_IDENTITY_BINDINGS" &&
      ! -L "$KEMERBET_AGENT_IDENTITY_BINDINGS" &&
      ! -e "$KEMERBET_RECHECK_RECEIPT_ROOT" && ! -L "$KEMERBET_RECHECK_RECEIPT_ROOT" &&
      ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
      ! -e "$KEMERBET_RECHECK_CANDIDATE_ROOT" && ! -L "$KEMERBET_RECHECK_CANDIDATE_ROOT" &&
      ! -L "$KEMERBET_READINESS_BINDING" && -f "$KEMERBET_READINESS_BINDING" &&
      "$(realpath -- "$KEMERBET_READINESS_BINDING")" == "$KEMERBET_READINESS_BINDING" &&
      "$(stat --format='%u:%g:%a:%h:%s:%d:%i' "$KEMERBET_READINESS_BINDING")" == \
        "10001:10001:600:1:230:$v2_binding_dev_ino" &&
      "$(sha256sum -- "$KEMERBET_READINESS_BINDING" | awk '{print $1}')" == \
        "$v2_binding_sha256" ]] || return 1
    active_binding="$KEMERBET_READINESS_BINDING"
    KEMERBET_V1_RETIREMENT_CONTINUITY_STATE='resealed-awaiting-recheck'
  else
    [[ ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
      ! -e "$KEMERBET_RECHECK_CANDIDATE_ROOT" && ! -L "$KEMERBET_RECHECK_CANDIDATE_ROOT" &&
      ! -e "$KEMERBET_READINESS_PLAYER_IDS" && ! -L "$KEMERBET_READINESS_PLAYER_IDS" &&
      ! -L "$KEMERBET_AGENT_IDENTITY_BINDINGS" &&
      -f "$KEMERBET_AGENT_IDENTITY_BINDINGS" &&
      "$(realpath -- "$KEMERBET_AGENT_IDENTITY_BINDINGS")" == \
        "$KEMERBET_AGENT_IDENTITY_BINDINGS" &&
      "$(stat --format='%U:%G:%a:%h:%s' "$KEMERBET_AGENT_IDENTITY_BINDINGS")" == \
        'root:root:444:1:230' &&
      "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_BINDINGS" | awk '{print $1}')" == \
        "$v2_binding_sha256" ]] || return 1
    [[ ! -L "$KEMERBET_RECHECK_RECEIPT_ROOT" && -d "$KEMERBET_RECHECK_RECEIPT_ROOT" &&
      "$(realpath -- "$KEMERBET_RECHECK_RECEIPT_ROOT")" == "$KEMERBET_RECHECK_RECEIPT_ROOT" &&
      "$(stat --format='%U:%G:%a' "$KEMERBET_RECHECK_RECEIPT_ROOT")" == 'root:root:700' ]] ||
      return 1
    receipt_entries="$(find -P "$KEMERBET_RECHECK_RECEIPT_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n')" ||
      return 1
    [[ "$receipt_entries" == 'ready-v1' &&
      ! -L "$KEMERBET_RECHECK_RECEIPT" && -f "$KEMERBET_RECHECK_RECEIPT" &&
      "$(realpath -- "$KEMERBET_RECHECK_RECEIPT")" == "$KEMERBET_RECHECK_RECEIPT" &&
      "$(stat --format='%U:%G:%a:%h' "$KEMERBET_RECHECK_RECEIPT")" == \
        'root:root:600:1' ]] || return 1
    mapfile -t receipt_lines <"$KEMERBET_RECHECK_RECEIPT" || return 1
    [[ "${#receipt_lines[@]}" -eq 8 &&
      "${receipt_lines[0]}" == 'version=1' &&
      "${receipt_lines[1]}" == "release=$KEMERBET_V1_RETIREMENT_RELEASE" &&
      "${receipt_lines[2]}" == "binding_sha256=$v2_binding_sha256" &&
      "${receipt_lines[3]}" == \
        "identity_hmac_key_sha256=$KEMERBET_V1_RETIREMENT_IDENTITY_KEY_SHA256" &&
      "${receipt_lines[4]}" =~ ^selector_sha256=[0-9a-f]{64}$ &&
      "${receipt_lines[5]}" =~ ^image_id=sha256:[0-9a-f]{64}$ &&
      "${receipt_lines[6]}" == "profile_volume=$KEMERBET_PROFILE_VOLUME" &&
      "${receipt_lines[7]}" =~ ^profile_identity_sha256=[0-9a-f]{64}$ ]] || return 1
    cmp -s -- "$KEMERBET_RECHECK_RECEIPT" <(printf '%s\n' "${receipt_lines[@]}") || return 1
    [[ ! -L "$KEMERBET_SELECTOR_CONTRACT" && -f "$KEMERBET_SELECTOR_CONTRACT" &&
      "$(realpath -- "$KEMERBET_SELECTOR_CONTRACT")" == "$KEMERBET_SELECTOR_CONTRACT" &&
      "$(stat --format='%U:%G:%a:%h' "$KEMERBET_SELECTOR_CONTRACT")" == \
        'root:root:444:1' &&
      "$(sha256sum -- "$KEMERBET_SELECTOR_CONTRACT" | awk '{print $1}')" == \
        "${receipt_lines[4]#selector_sha256=}" ]] || return 1
    active_binding="$KEMERBET_AGENT_IDENTITY_BINDINGS"
    KEMERBET_V1_RETIREMENT_CONTINUITY_STATE='committed'
  fi

  LC_ALL=C grep -Eq \
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12} hmac-sha256-agent-identity-v1:[0-9a-f]{64} sha256-provider-authorization-v1:[0-9a-f]{64}$' \
    "$active_binding" || return 1
  binding_line="$(<"$active_binding")"
  IFS=' ' read -r account_id identity_fingerprint provider_authorization_digest binding_residue \
    <<<"$binding_line"
  [[ -n "$account_id" && -n "$identity_fingerprint" &&
    -n "$provider_authorization_digest" && -z "$binding_residue" ]] || return 1
  v1_projection_sha256="$(printf '%s %s\n' "$account_id" "$identity_fingerprint" | sha256sum | awk '{print $1}')" ||
    return 1
  [[ "$v1_projection_sha256" == "$KEMERBET_V1_RETIREMENT_LEGACY_SHA256" &&
    "$KEMERBET_V1_RETIREMENT_CONTINUITY_STATE" =~ ^(resealed-awaiting-recheck|committed)$ ]]
}

require_kemerbet_v1_retirement_disposable_inputs_absent() {
  local path
  for path in \
    "$SECRET_ROOT/owner-database-url" \
    "$SECRET_ROOT/publishable-key" \
    "$SECRET_ROOT/customer-web-database-url" \
    "$SECRET_ROOT/customer-web-publishable-key" \
    "$SECRET_ROOT/customer-web-rate-limit-hmac" \
    "$SECRET_ROOT/beta-database-url" \
    "$SECRET_ROOT/beta-transport-hmac" \
    "$SECRET_ROOT/bot-transport-hmac" \
    "$SECRET_ROOT/beta-payload-hmac" \
    "$SECRET_ROOT/player-action-database-url" \
    "$SECRET_ROOT/api-action-transport-hmac" \
    "$SECRET_ROOT/api-action-payload-hmac" \
    "$SECRET_ROOT/api-action-capability-hmac" \
    "$SECRET_ROOT/api-action-semantic-hmac" \
    "$SECRET_ROOT/cbe-deposit-reference-encryption-key" \
    "$SECRET_ROOT/cbe-deposit-reference-fingerprint-key" \
    "$SECRET_ROOT/cbe-deposit-reference-key-profile.v1.json" \
    "$SECRET_ROOT/deposit-proof-reference-encryption-master" \
    "$SECRET_ROOT/deposit-proof-reference-fingerprint-master" \
    "$SECRET_ROOT/deposit-proof-reference-profile.v2.json" \
    "$SECRET_ROOT/bot-action-transport-hmac" \
    "$SECRET_ROOT/bot-token" \
    "$SECRET_ROOT/supabase-ca.crt" \
    "$BOT_STARTUP_RECEIPT" \
    "$BOT_STARTUP_RECEIPT_ROOT"; do
    [[ ! -e "$path" && ! -L "$path" ]] || return 1
  done
  require_kemerbet_v1_reinstall_target_temps_absent
}

KEMERBET_V1_REINSTALL_RELEASE=''
KEMERBET_V1_REINSTALL_BUNDLE_SHA256=''
KEMERBET_V1_REINSTALL_CONTEXT_SHA256=''
KEMERBET_V1_REINSTALL_ASSET_SHA256=''

read_kemerbet_v1_reinstall_journal() {
  local journal="${1:-$KEMERBET_V1_REINSTALL_JOURNAL}"
  local -a lines=()
  case "$journal" in
    "$KEMERBET_V1_REINSTALL_JOURNAL")
      [[ ! -L "$journal" && -f "$journal" &&
        "$(realpath -- "$journal")" == "$journal" &&
        "$(stat --format='%U:%G:%a:%h' "$journal")" =~ ^root:root:600:(1|2)$ &&
        "$(stat --format='%s' "$journal")" -le 1024 ]] || return 1
      if [[ "$(stat --format='%h' "$journal")" == '2' ]]; then
        [[ ! -L "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" &&
          -f "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" &&
          "$(stat --format='%d:%i' "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING")" == \
            "$(stat --format='%d:%i' "$journal")" ]] || return 1
      fi
      ;;
    "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING")
      [[ ! -e "$KEMERBET_V1_REINSTALL_JOURNAL" &&
        ! -L "$KEMERBET_V1_REINSTALL_JOURNAL" &&
        ! -L "$journal" && -f "$journal" &&
        "$(realpath -- "$journal")" == "$journal" &&
        "$(stat --format='%U:%G:%a:%h' "$journal")" == 'root:root:600:1' &&
        "$(stat --format='%s' "$journal")" -le 1024 ]] || return 1
      ;;
    *) return 1 ;;
  esac
  mapfile -t lines <"$journal" || return 1
  [[ "${#lines[@]}" -eq 5 &&
    "${lines[0]}" == 'contract=fetanagent-kemerbet-v1-retirement-secrets-reinstall-v1' &&
    "${lines[1]}" =~ ^release=[0-9a-f]{40}$ &&
    "${lines[2]}" =~ ^bundle_sha256=[0-9a-f]{64}$ &&
    "${lines[3]}" =~ ^context_sha256=[0-9a-f]{64}$ &&
    "${lines[4]}" =~ ^asset_sha256=[0-9a-f]{64}$ ]] || return 1
  KEMERBET_V1_REINSTALL_RELEASE="${lines[1]#release=}"
  KEMERBET_V1_REINSTALL_BUNDLE_SHA256="${lines[2]#bundle_sha256=}"
  KEMERBET_V1_REINSTALL_CONTEXT_SHA256="${lines[3]#context_sha256=}"
  KEMERBET_V1_REINSTALL_ASSET_SHA256="${lines[4]#asset_sha256=}"
  cmp -s -- "$journal" <(printf '%s\n' \
    'contract=fetanagent-kemerbet-v1-retirement-secrets-reinstall-v1' \
    "release=$KEMERBET_V1_REINSTALL_RELEASE" \
    "bundle_sha256=$KEMERBET_V1_REINSTALL_BUNDLE_SHA256" \
    "context_sha256=$KEMERBET_V1_REINSTALL_CONTEXT_SHA256" \
    "asset_sha256=$KEMERBET_V1_REINSTALL_ASSET_SHA256")
}

publish_kemerbet_v1_reinstall_journal() {
  local release="$1" bundle_sha256="$2" context_sha256="$3" asset_sha256="$4"
  local parent parent_mode parent_stat
  [[ "$release" =~ ^[0-9a-f]{40}$ && "$bundle_sha256" =~ ^[0-9a-f]{64}$ &&
    "$context_sha256" =~ ^[0-9a-f]{64}$ && "$asset_sha256" =~ ^[0-9a-f]{64}$ ]] ||
    return 1
  parent="$(dirname -- "$KEMERBET_V1_REINSTALL_JOURNAL")" || return 1
  [[ ! -L "$parent" && -d "$parent" && "$(realpath -- "$parent")" == "$parent" &&
    "$(stat --format='%U:%G' "$parent")" == 'root:root' ]] || return 1
  parent_mode="$(stat --format='%a' "$parent")" || return 1
  [[ "$parent_mode" =~ ^[0-7]{3,4}$ ]] || return 1
  (( (8#$parent_mode & 8#022) == 0 )) || return 1
  parent_stat="$(stat --format='%d:%i:%u:%g:%a:%h' "$parent")" || return 1
  if [[ -e "$KEMERBET_V1_REINSTALL_JOURNAL" || -L "$KEMERBET_V1_REINSTALL_JOURNAL" ]]; then
    read_kemerbet_v1_reinstall_journal || return 1
    [[ "$KEMERBET_V1_REINSTALL_RELEASE" == "$release" &&
      "$KEMERBET_V1_REINSTALL_BUNDLE_SHA256" == "$bundle_sha256" &&
      "$KEMERBET_V1_REINSTALL_CONTEXT_SHA256" == "$context_sha256" &&
      "$KEMERBET_V1_REINSTALL_ASSET_SHA256" == "$asset_sha256" ]] || return 1
    if [[ -e "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" ||
      -L "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" ]]; then
      [[ ! -L "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" &&
        -f "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" &&
        "$(stat --format='%d:%i' "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING")" == \
          "$(stat --format='%d:%i' "$KEMERBET_V1_REINSTALL_JOURNAL")" ]] || return 1
      rm -f -- "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" || return 1
      sync -f "$parent" || return 1
    fi
    read_kemerbet_v1_reinstall_journal || return 1
    [[ "$(stat --format='%d:%i:%u:%g:%a:%h' "$parent")" == "$parent_stat" ]]
    return $?
  fi
  if [[ -e "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" ||
    -L "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" ]]; then
    read_kemerbet_v1_reinstall_journal "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" ||
      return 1
    [[ "$KEMERBET_V1_REINSTALL_RELEASE" == "$release" &&
      "$KEMERBET_V1_REINSTALL_BUNDLE_SHA256" == "$bundle_sha256" &&
      "$KEMERBET_V1_REINSTALL_CONTEXT_SHA256" == "$context_sha256" &&
      "$KEMERBET_V1_REINSTALL_ASSET_SHA256" == "$asset_sha256" ]] || return 1
  else
    (set -o noclobber; umask 077; printf '%s\n' \
      'contract=fetanagent-kemerbet-v1-retirement-secrets-reinstall-v1' \
      "release=$release" \
      "bundle_sha256=$bundle_sha256" \
      "context_sha256=$context_sha256" \
      "asset_sha256=$asset_sha256" >"$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING") || return 1
    chown root:root "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" || return 1
    chmod 0600 "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" || return 1
    sync -f "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" || return 1
  fi
  ln -- "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" "$KEMERBET_V1_REINSTALL_JOURNAL" ||
    return 1
  rm -f -- "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" || return 1
  sync -f "$parent" || return 1
  read_kemerbet_v1_reinstall_journal &&
    [[ "$KEMERBET_V1_REINSTALL_RELEASE" == "$release" &&
      "$KEMERBET_V1_REINSTALL_BUNDLE_SHA256" == "$bundle_sha256" &&
      "$KEMERBET_V1_REINSTALL_CONTEXT_SHA256" == "$context_sha256" &&
      "$KEMERBET_V1_REINSTALL_ASSET_SHA256" == "$asset_sha256" &&
      "$(stat --format='%d:%i:%u:%g:%a:%h' "$parent")" == "$parent_stat" ]]
}

remove_kemerbet_v1_reinstall_journal() {
  local parent parent_mode parent_stat
  read_kemerbet_v1_reinstall_journal || return 1
  [[ ! -e "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" &&
    ! -L "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" ]] || return 1
  parent="$(dirname -- "$KEMERBET_V1_REINSTALL_JOURNAL")" || return 1
  [[ ! -L "$parent" && -d "$parent" && "$(realpath -- "$parent")" == "$parent" &&
    "$(stat --format='%U:%G' "$parent")" == 'root:root' ]] || return 1
  parent_mode="$(stat --format='%a' "$parent")" || return 1
  [[ "$parent_mode" =~ ^[0-7]{3,4}$ ]] || return 1
  (( (8#$parent_mode & 8#022) == 0 )) || return 1
  parent_stat="$(stat --format='%d:%i:%u:%g:%a:%h' "$parent")" || return 1
  rm -f -- "$KEMERBET_V1_REINSTALL_JOURNAL" || return 1
  sync -f "$parent" || return 1
  [[ ! -e "$KEMERBET_V1_REINSTALL_JOURNAL" && ! -L "$KEMERBET_V1_REINSTALL_JOURNAL" &&
    "$(stat --format='%d:%i:%u:%g:%a:%h' "$parent")" == "$parent_stat" ]]
}

require_kemerbet_v1_reinstall_partial_prefix() {
  [[ ! -e "$KEMERBET_V1_REINSTALL_JOURNAL" &&
    ! -L "$KEMERBET_V1_REINSTALL_JOURNAL" &&
    ! -L "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" &&
    -f "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" &&
    "$(realpath -- "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING")" == \
      "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" &&
    "$(stat --format='%U:%G:%a:%h' "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING")" == \
      'root:root:600:1' &&
    "$(stat --format='%s' "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING")" -le 1024 ]] ||
    return 1
  env -i PATH="$SAFE_PATH" python3 -I - "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" <<'PY'
import os
import stat
import sys

HEX = b'0123456789abcdef'


def reject():
    raise RuntimeError()


def journal_prefix_contract():
    contract = []
    for literal, width in (
        (b'contract=fetanagent-kemerbet-v1-retirement-secrets-reinstall-v1\nrelease=', 40),
        (b'\nbundle_sha256=', 64),
        (b'\ncontext_sha256=', 64),
        (b'\nasset_sha256=', 64),
    ):
        contract.extend(bytes((byte,)) for byte in literal)
        contract.extend([HEX] * width)
    contract.append(b'\n')
    return contract


try:
    if len(sys.argv) != 2:
        reject()
    path = sys.argv[1]
    if os.path.realpath(path) != path:
        reject()
    before = os.lstat(path)
    if (
        not stat.S_ISREG(before.st_mode)
        or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink)
        != (0, 0, 0o600, 1)
    ):
        reject()
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        opened = os.fstat(descriptor)
        content = os.pread(descriptor, 1025, 0)
    finally:
        os.close(descriptor)
    after = os.lstat(path)
    for observed in (opened, after):
        if (
            observed.st_mode != before.st_mode
            or observed.st_uid != before.st_uid
            or observed.st_gid != before.st_gid
            or observed.st_nlink != before.st_nlink
            or observed.st_size != before.st_size
            or (observed.st_dev, observed.st_ino) != (before.st_dev, before.st_ino)
        ):
            reject()
    contract = journal_prefix_contract()
    if len(content) != before.st_size or len(content) > len(contract):
        reject()
    if any(byte not in contract[index] for index, byte in enumerate(content)):
        reject()
except Exception:
    raise SystemExit(1)
PY
}

remove_kemerbet_v1_reinstall_partial_prefix() {
  local parent parent_mode parent_stat
  require_kemerbet_v1_reinstall_partial_prefix || return 1
  parent="$(dirname -- "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING")" || return 1
  [[ ! -L "$parent" && -d "$parent" && "$(realpath -- "$parent")" == "$parent" &&
    "$(stat --format='%U:%G' "$parent")" == 'root:root' ]] || return 1
  parent_mode="$(stat --format='%a' "$parent")" || return 1
  [[ "$parent_mode" =~ ^[0-7]{3,4}$ ]] || return 1
  (( (8#$parent_mode & 8#022) == 0 )) || return 1
  parent_stat="$(stat --format='%d:%i:%u:%g:%a:%h' "$parent")" || return 1
  rm -f -- "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" || return 1
  sync -f "$parent" || return 1
  [[ ! -e "$KEMERBET_V1_REINSTALL_JOURNAL" &&
    ! -L "$KEMERBET_V1_REINSTALL_JOURNAL" &&
    ! -e "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" &&
    ! -L "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" &&
    "$(stat --format='%d:%i:%u:%g:%a:%h' "$parent")" == "$parent_stat" ]]
}

abort_kemerbet_v1_reinstall_journal_after_full_expiry() {
  local asset_sha256 bundle_sha256 context_sha256 release
  if [[ ! -e "$KEMERBET_V1_REINSTALL_JOURNAL" &&
    ! -L "$KEMERBET_V1_REINSTALL_JOURNAL" &&
    ! -e "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" &&
    ! -L "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" ]]; then
    return 0
  fi
  if [[ -e "$KEMERBET_V1_REINSTALL_JOURNAL" ||
    -L "$KEMERBET_V1_REINSTALL_JOURNAL" ]]; then
    read_kemerbet_v1_reinstall_journal || return 1
  else
    if ! read_kemerbet_v1_reinstall_journal \
      "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING"; then
      require_kemerbet_v1_reinstall_partial_prefix || return 1
      read_kemerbet_v1_retirement_intent_metadata || return 1
      release="$KEMERBET_V1_RETIREMENT_RELEASE"
      require_kemerbet_v1_retirement_reinstall_boundary initial || return 1
      require_kemerbet_v1_retirement_recovery_topology "$release" || return 1
      kemerbet_v1_retirement_release_asset_digest "$release" >/dev/null || return 1
      remove_kemerbet_v1_reinstall_partial_prefix || return 1
      require_kemerbet_v1_retirement_reinstall_boundary initial
      return $?
    fi
  fi
  release="$KEMERBET_V1_REINSTALL_RELEASE"
  bundle_sha256="$KEMERBET_V1_REINSTALL_BUNDLE_SHA256"
  context_sha256="$KEMERBET_V1_REINSTALL_CONTEXT_SHA256"
  asset_sha256="$KEMERBET_V1_REINSTALL_ASSET_SHA256"
  require_kemerbet_v1_retirement_reinstall_boundary initial || return 1
  [[ "$(kemerbet_v1_retirement_recovery_context_digest "$release")" == \
      "$context_sha256" &&
    "$(kemerbet_v1_retirement_release_asset_digest "$release")" == \
      "$asset_sha256" ]] || return 1
  publish_kemerbet_v1_reinstall_journal \
    "$release" "$bundle_sha256" "$context_sha256" "$asset_sha256" || return 1
  require_kemerbet_v1_retirement_reinstall_boundary initial || return 1
  read_kemerbet_v1_reinstall_journal || return 1
  [[ "$KEMERBET_V1_REINSTALL_RELEASE" == "$release" &&
    "$KEMERBET_V1_REINSTALL_BUNDLE_SHA256" == "$bundle_sha256" &&
    "$KEMERBET_V1_REINSTALL_CONTEXT_SHA256" == "$context_sha256" &&
    "$KEMERBET_V1_REINSTALL_ASSET_SHA256" == "$asset_sha256" ]] || return 1
  remove_kemerbet_v1_reinstall_journal || return 1
  [[ ! -e "$KEMERBET_V1_REINSTALL_JOURNAL" &&
    ! -L "$KEMERBET_V1_REINSTALL_JOURNAL" &&
    ! -e "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" &&
    ! -L "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" ]] || return 1
  require_kemerbet_v1_retirement_reinstall_boundary initial
}

require_kemerbet_v1_retirement_expiry_guard_disarmed() {
  local load_state
  [[ ! -e "$EXPIRY_STOP_TIMER_PATH" && ! -L "$EXPIRY_STOP_TIMER_PATH" &&
    ! -e "$EXPIRY_STOP_SERVICE_PATH" && ! -L "$EXPIRY_STOP_SERVICE_PATH" ]] || return 1
  command -v systemctl >/dev/null 2>&1 || return 1
  load_state="$(systemctl show --property=LoadState --value "$EXPIRY_STOP_TIMER" 2>/dev/null)" ||
    return 1
  [[ "$load_state" == 'not-found' ]]
}

require_kemerbet_v1_retirement_expiry_guard_armed() {
  local calendar path stop_epoch now_epoch
  local -a timer_lines=()
  command -v systemctl >/dev/null 2>&1 || return 1
  for path in "$EXPIRY_STOP_SERVICE_PATH" "$EXPIRY_STOP_TIMER_PATH"; do
    [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
      "$(stat --format='%U:%G:%a:%h' "$path")" == 'root:root:644:1' ]] || return 1
  done
  cmp -s -- "$EXPIRY_STOP_SERVICE_PATH" <(printf '%s\n' \
    '[Unit]' \
    'Description=Stop FetanAgent staging before disposable database credentials expire' \
    'StartLimitIntervalSec=0' \
    '' \
    '[Service]' \
    'Type=oneshot' \
    'Environment=FETANAGENT_STAGING_EXPIRY_GUARD=1' \
    "ExecStart=$HELPER_PATH expiry-stop" \
    'Restart=on-failure' \
    'RestartSec=60' \
    'NoNewPrivileges=true' \
    'PrivateTmp=true' \
    'UMask=0077') || return 1
  mapfile -t timer_lines <"$EXPIRY_STOP_TIMER_PATH" || return 1
  [[ "${#timer_lines[@]}" -eq 11 &&
    "${timer_lines[0]}" == '[Unit]' &&
    "${timer_lines[1]}" == 'Description=FetanAgent staging disposable-credential expiry guard' &&
    -z "${timer_lines[2]}" &&
    "${timer_lines[3]}" == '[Timer]' &&
    "${timer_lines[4]}" =~ ^OnCalendar=[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}\ UTC$ &&
    "${timer_lines[5]}" == 'AccuracySec=1min' &&
    "${timer_lines[6]}" == 'Persistent=true' &&
    "${timer_lines[7]}" == "Unit=$EXPIRY_STOP_SERVICE" &&
    -z "${timer_lines[8]}" &&
    "${timer_lines[9]}" == '[Install]' &&
    "${timer_lines[10]}" == 'WantedBy=timers.target' ]] || return 1
  calendar="${timer_lines[4]#OnCalendar=}"
  stop_epoch="$(date -u -d "$calendar" +%s)" || return 1
  now_epoch="$(date -u +%s)" || return 1
  [[ "$stop_epoch" =~ ^[0-9]+$ && "$now_epoch" =~ ^[0-9]+$ ]] || return 1
  (( stop_epoch > now_epoch && stop_epoch <= now_epoch + 23 * 60 * 60 )) || return 1
  [[ "$(systemctl show --property=LoadState --value "$EXPIRY_STOP_TIMER" 2>/dev/null)" == \
      'loaded' &&
    "$(systemctl show --property=FragmentPath --value "$EXPIRY_STOP_TIMER" 2>/dev/null)" == \
      "$EXPIRY_STOP_TIMER_PATH" &&
    "$(systemctl show --property=LoadState --value "$EXPIRY_STOP_SERVICE" 2>/dev/null)" == \
      'loaded' &&
    "$(systemctl show --property=FragmentPath --value "$EXPIRY_STOP_SERVICE" 2>/dev/null)" == \
      "$EXPIRY_STOP_SERVICE_PATH" ]] || return 1
  systemctl is-enabled --quiet "$EXPIRY_STOP_TIMER" &&
    systemctl is-active --quiet "$EXPIRY_STOP_TIMER"
}

KEMERBET_V1_RETIREMENT_DURABLE_VOLUME_DIGEST=''

inspect_kemerbet_durable_volume_contract() {
  [[ $# -eq 2 ]] || return 1
  local compose_config_hash compose_version driver expected_volume_label="$2" label_count
  local mountpoint name options project residue scope volume="$1" volume_contract volume_label
  case "$expected_volume_label" in
    kemerbet_sessions|kemerbet_session_control) ;;
    *) return 1 ;;
  esac
  volume_contract="$(docker_local volume inspect "$volume" \
    --format '{{.Name}}|{{.Driver}}|{{.Scope}}|{{json .Options}}|{{len .Labels}}|{{ index .Labels "com.docker.compose.project" }}|{{ index .Labels "com.docker.compose.version" }}|{{ index .Labels "com.docker.compose.volume" }}|{{with index .Labels "com.docker.compose.config-hash"}}{{.}}{{end}}|{{.Mountpoint}}')" ||
    return 1
  IFS='|' read -r name driver scope options label_count project compose_version \
    volume_label compose_config_hash mountpoint residue <<<"$volume_contract"
  [[ -z "$residue" && "$name" == "$volume" && "$driver" == 'local' &&
    "$scope" == 'local' && "$options" == 'null' && "$project" == "$PROJECT_NAME" &&
    "$compose_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+~-][0-9A-Za-z._-]+)?$ &&
    "$volume_label" == "$expected_volume_label" &&
    "$mountpoint" == "/var/lib/docker/volumes/$volume/_data" ]] || return 1
  case "$label_count" in
    3)
      [[ -z "$compose_config_hash" ]] || return 1
      printf '%s' \
        "$name|$driver|$scope|$options|$label_count|$project|$compose_version|$volume_label|$mountpoint"
      ;;
    4) [[ "$compose_config_hash" =~ ^[0-9a-f]{64}$ ]] || return 1 ;;
    *) return 1 ;;
  esac
  if [[ "$label_count" == '4' ]]; then
    printf '%s' "$volume_contract"
  fi
}

require_kemerbet_v1_retirement_durable_volumes() {
  local account_id binding_line claim_digest control_mountpoint expected_volumes identity_binding profile_digest
  local control_contract profile_contract profile_mountpoint project_volumes provider_binding residue
  local volume volume_compose_version volume_contract volume_label_count volume_label_schema
  KEMERBET_V1_RETIREMENT_DURABLE_VOLUME_DIGEST=''
  project_volumes="$(docker_local volume ls --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" | LC_ALL=C sort)" || return 1
  expected_volumes="$(printf '%s\n%s\n' \
    "$KEMERBET_PROFILE_VOLUME" "$KEMERBET_SESSION_CONTROL_VOLUME" | LC_ALL=C sort)"
  [[ "$project_volumes" == "$expected_volumes" ]] || return 1
  volume_compose_version=''
  volume_label_schema=''
  for volume in "$KEMERBET_PROFILE_VOLUME" "$KEMERBET_SESSION_CONTROL_VOLUME"; do
    case "$volume" in
      "$KEMERBET_PROFILE_VOLUME")
        volume_contract="$(inspect_kemerbet_durable_volume_contract \
          "$volume" kemerbet_sessions)" || return 1
        ;;
      "$KEMERBET_SESSION_CONTROL_VOLUME")
        volume_contract="$(inspect_kemerbet_durable_volume_contract \
          "$volume" kemerbet_session_control)" || return 1
        ;;
    esac
    if [[ -z "$volume_compose_version" ]]; then
      volume_compose_version="$(cut -d '|' -f 7 <<<"$volume_contract")"
    else
      [[ "$(cut -d '|' -f 7 <<<"$volume_contract")" == "$volume_compose_version" ]] ||
        return 1
    fi
    volume_label_count="$(cut -d '|' -f 5 <<<"$volume_contract")"
    if [[ -z "$volume_label_schema" ]]; then
      volume_label_schema="$volume_label_count"
    else
      [[ "$volume_label_count" == "$volume_label_schema" ]] || return 1
    fi
    case "$volume" in
      "$KEMERBET_PROFILE_VOLUME")
        profile_contract="$volume_contract"
        ;;
      "$KEMERBET_SESSION_CONTROL_VOLUME")
        control_contract="$volume_contract"
        ;;
    esac
    [[ -z "$(docker_local container ls --all --quiet --filter "volume=$volume")" ]] || return 1
  done
  control_mountpoint="$(resolve_kemerbet_session_control_volume_mountpoint)" || return 1
  profile_mountpoint="$(resolve_kemerbet_profile_volume_mountpoint)" || return 1
  [[ "$control_mountpoint" == "/var/lib/docker/volumes/$KEMERBET_SESSION_CONTROL_VOLUME/_data" &&
    "$profile_mountpoint" == "/var/lib/docker/volumes/$KEMERBET_PROFILE_VOLUME/_data" ]] || return 1
  inspect_owner_staged_kemerbet_cohort_for_retirement_context || return 1
  require_owner_kemerbet_failed_marker_read_only "$KEMERBET_RECHECK_OWNER_CLAIM_ID" || return 1
  claim_digest="$(printf '%s\n' "$KEMERBET_RECHECK_OWNER_CLAIM_ID" | sha256sum | awk '{print $1}')" ||
    return 1
  if [[ -e "$KEMERBET_V1_RETIREMENT_ARCHIVE" || -L "$KEMERBET_V1_RETIREMENT_ARCHIVE" ]]; then
    require_kemerbet_v1_retirement_archive || return 1
    binding_line="$(<"$KEMERBET_V1_RETIREMENT_ARCHIVE")"
  else
    [[ ! -L "$KEMERBET_READINESS_BINDING" && -f "$KEMERBET_READINESS_BINDING" ]] || return 1
    binding_line="$(<"$KEMERBET_READINESS_BINDING")"
  fi
  IFS=' ' read -r account_id identity_binding provider_binding residue <<<"$binding_line"
  [[ "$account_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ &&
    "$identity_binding" =~ ^hmac-sha256-agent-identity-v1:[0-9a-f]{64}$ &&
    ( -z "$provider_binding" ||
      "$provider_binding" =~ ^sha256-provider-authorization-v1:[0-9a-f]{64}$ ) &&
    -z "$residue" ]] || return 1
  profile_digest="$(kemerbet_profile_identity_digest \
    "$account_id" "$profile_mountpoint" allow-exact-stale-singletons)" || return 1
  [[ "$profile_digest" =~ ^[0-9a-f]{64}$ ]] || return 1
  KEMERBET_V1_RETIREMENT_DURABLE_VOLUME_DIGEST="$({
    printf '%s\n' \
      "control_contract=$control_contract" \
      "profile_contract=$profile_contract" \
      "control=$(stat --format='%d:%i:%u:%g:%a:%h' "$control_mountpoint")" \
      "profile=$(stat --format='%d:%i:%u:%g:%a:%h' "$profile_mountpoint")" \
      "profile_identity=$profile_digest" \
      "player=$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO:$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" \
      "claim=$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO:$claim_digest"
  } | sha256sum | awk '{print $1}')" || return 1
  [[ "$KEMERBET_V1_RETIREMENT_DURABLE_VOLUME_DIGEST" =~ ^[0-9a-f]{64}$ ]]
}

kemerbet_v1_retirement_recovery_context_digest() {
  local commit_sha="$1" path
  require_kemerbet_v1_retirement_current_context "$commit_sha" || return 1
  require_kemerbet_v1_retirement_recovery_topology "$commit_sha" || return 1
  require_kemerbet_v1_retirement_durable_volumes || return 1
  {
    printf '%s\n' "volume=$KEMERBET_V1_RETIREMENT_DURABLE_VOLUME_DIGEST"
    for path in \
      "$KEMERBET_V1_RETIREMENT_INTENT" \
      "$KEMERBET_V1_RETIREMENT_ARCHIVE" \
      "$KEMERBET_V1_RETIREMENT_COMPLETION" \
      "$KEMERBET_READINESS_BINDING" \
      "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" \
      "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_FAILED_CLAIM_NAME"; do
      if [[ -e "$path" || -L "$path" ]]; then
        [[ ! -L "$path" && -f "$path" ]] || return 1
        printf '%s:%s\n' \
          "$(stat --format='%d:%i:%u:%g:%a:%h:%s:%Y' "$path")" \
          "$(sha256sum -- "$path" | awk '{print $1}')"
      else
        printf '%s\n' absent
      fi
    done
  } | sha256sum | awk '{print $1}'
}

kemerbet_v1_retirement_release_asset_digest() {
  local commit_sha="$1" compose_file image image_contract
  local -a images=(api beta-admission bot customer-web deposit-executor gateway owner-control)
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || return 1
  compose_file="$RELEASE_ROOT/$commit_sha/infra/compose.staging-beta.yaml"
  [[ ! -L "$compose_file" && -f "$compose_file" &&
    "$(realpath -- "$compose_file")" == "$compose_file" &&
    "$(stat --format='%U:%G:%a:%h' "$compose_file")" == 'root:root:444:1' ]] || return 1
  {
    printf 'compose=%s:%s\n' \
      "$(stat --format='%d:%i:%u:%g:%a:%h:%s:%Y' "$compose_file")" \
      "$(sha256sum -- "$compose_file" | awk '{print $1}')"
    for image in "${images[@]}"; do
      image_contract="$(docker_local image inspect \
        "fetanagent-$image:${commit_sha:0:12}" \
        --format '{{.Id}}|{{ index .Config.Labels "org.opencontainers.image.revision" }}|{{ index .Config.Labels "org.opencontainers.image.title" }}|{{.Config.User}}')" || return 1
      [[ "$image_contract" == sha256:[0-9a-f]*"|$commit_sha|"* &&
        "${image_contract%%|*}" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
      printf '%s=%s\n' "$image" "$image_contract"
    done
  } | sha256sum | awk '{print $1}'
}

require_kemerbet_v1_retirement_reinstall_boundary() {
  local policy="${1:-initial}" containers networks
  case "$policy" in
    initial) require_kemerbet_v1_retirement_disposable_inputs_absent || return 1 ;;
    resume)
      [[ ! -e "$BOT_STARTUP_RECEIPT" && ! -L "$BOT_STARTUP_RECEIPT" &&
        ! -e "$BOT_STARTUP_RECEIPT_ROOT" && ! -L "$BOT_STARTUP_RECEIPT_ROOT" ]] || return 1
      ;;
    *) return 1 ;;
  esac
  require_kemerbet_v1_reinstall_target_temps_absent || return 1
  require_kemerbet_v1_retirement_expiry_guard_disarmed || return 1
  containers="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")" || return 1
  networks="$(docker_local network ls --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")" || return 1
  [[ -z "$containers" && -z "$networks" ]] || return 1
  require_kemerbet_recheck_transients_absent || return 1
  require_kemerbet_v1_retirement_durable_volumes
}

require_kemerbet_v1_retirement_safe_reset_boundary() {
  local containers networks
  require_kemerbet_v1_retirement_expiry_guard_disarmed || return 1
  containers="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")" || return 1
  networks="$(docker_local network ls --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")" || return 1
  [[ -z "$containers" && -z "$networks" ]] || return 1
  require_kemerbet_recheck_transients_absent || return 1
  require_kemerbet_v1_retirement_durable_volumes
}

finalize_kemerbet_v1_retirement_safe_reset_after_full_teardown() {
  local release
  inspect_kemerbet_v1_retirement_gate
  [[ "$KEMERBET_V1_RETIREMENT_GATE_STATE" == 'seal-finalization-prefix' ]] || return 0
  release="$KEMERBET_V1_RETIREMENT_GATE_RELEASE"
  [[ "$release" =~ ^[0-9a-f]{40}$ ]] || return 1
  require_kemerbet_v1_retirement_safe_reset_boundary || return 1
  require_kemerbet_v1_retirement_current_context "$release" || return 1
  [[ "$(kemerbet_v1_retirement_release_asset_digest "$release")" == \
    "$KEMERBET_V1_RETIREMENT_RELEASE_ASSET_SHA256" ]] || return 1
  finalize_kemerbet_v1_retirement_after_v2_seal "$release" || return 1
  inspect_kemerbet_v1_retirement_gate
  [[ "$KEMERBET_V1_RETIREMENT_GATE_STATE" == 'resealed-awaiting-recheck' &&
    "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" == "$release" ]] || return 1
  require_kemerbet_v1_retirement_safe_reset_boundary
}

classify_kemerbet_v1_retirement_bot_receipt_reset_state() {
  local entries
  if [[ ! -e "$BOT_STARTUP_RECEIPT_ROOT" && ! -L "$BOT_STARTUP_RECEIPT_ROOT" &&
    ! -e "$BOT_STARTUP_RECEIPT" && ! -L "$BOT_STARTUP_RECEIPT" ]]; then
    printf '%s\n' absent
    return 0
  fi
  [[ ! -L "$BOT_STARTUP_RECEIPT_ROOT" && -d "$BOT_STARTUP_RECEIPT_ROOT" &&
    "$(realpath -- "$BOT_STARTUP_RECEIPT_ROOT")" == "$BOT_STARTUP_RECEIPT_ROOT" &&
    "$(stat --format='%U:%G:%a:%h' "$BOT_STARTUP_RECEIPT_ROOT")" == 'root:root:700:2' ]] ||
    return 1
  entries="$(find -P "$BOT_STARTUP_RECEIPT_ROOT" -mindepth 1 -maxdepth 1 \
    -printf '%f\n' | LC_ALL=C sort)" || return 1
  [[ -z "$entries" || "$entries" == 'bot-v1' ]] || return 1
  if [[ "$entries" == 'bot-v1' ]]; then
    [[ ! -L "$BOT_STARTUP_RECEIPT" && -f "$BOT_STARTUP_RECEIPT" &&
      "$(realpath -- "$BOT_STARTUP_RECEIPT")" == "$BOT_STARTUP_RECEIPT" &&
      "$(stat --format='%U:%G:%a:%h' "$BOT_STARTUP_RECEIPT")" == 'root:root:600:1' &&
      "$(stat --format='%s' "$BOT_STARTUP_RECEIPT")" -gt 0 &&
      "$(stat --format='%s' "$BOT_STARTUP_RECEIPT")" -le 4096 ]] || return 1
  fi
  printf '%s\n' present
}

classify_kemerbet_v1_retirement_input_reset_state() {
  local commit_sha="$1" status
  set +e
  inspect_kemerbet_v1_reinstall_residue "$commit_sha"
  status=$?
  set -e
  case "$status" in
    0) printf '%s\n' present ;;
    1) printf '%s\n' absent ;;
    *) return 1 ;;
  esac
}

classify_kemerbet_v1_retirement_journal_reset_state() {
  local commit_sha="$1" context_sha256 journal_state='absent'
  if [[ ! -e "$KEMERBET_V1_REINSTALL_JOURNAL" &&
    ! -L "$KEMERBET_V1_REINSTALL_JOURNAL" &&
    ! -e "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" &&
    ! -L "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" ]]; then
    printf '%s\n' absent
    return 0
  fi
  if [[ -e "$KEMERBET_V1_REINSTALL_JOURNAL" ||
    -L "$KEMERBET_V1_REINSTALL_JOURNAL" ]]; then
    read_kemerbet_v1_reinstall_journal || return 1
    journal_state='exact'
  elif read_kemerbet_v1_reinstall_journal \
    "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING"; then
    journal_state='exact'
  else
    require_kemerbet_v1_reinstall_partial_prefix || return 1
    printf '%s\n' present
    return 0
  fi
  [[ "$journal_state" == 'exact' &&
    "$KEMERBET_V1_REINSTALL_RELEASE" == "$commit_sha" &&
    "$KEMERBET_V1_REINSTALL_ASSET_SHA256" == \
      "$KEMERBET_V1_RETIREMENT_RELEASE_ASSET_SHA256" ]] || return 1
  context_sha256="$(kemerbet_v1_retirement_recovery_context_digest "$commit_sha")" ||
    return 1
  [[ "$KEMERBET_V1_REINSTALL_CONTEXT_SHA256" == "$context_sha256" ]] || return 1
  printf '%s\n' present
}

kemerbet_v1_retirement_secret_bundle() {
  local mode="$1" incoming="$2" expected_digest="${3:-}" expected_uid digest_fd python_status
  [[ "$mode" == 'inspect' || "$mode" == 'apply' || "$mode" == 'verify-targets' ||
    "$mode" == 'inspect-target-temps' || "$mode" == 'classify-target-temps' ||
    "$mode" == 'purge-target-temps' || "$mode" == 'classify-reset-targets' ]] ||
    return 1
  expected_uid="$(id -u "$EXPECTED_SUDO_USER")" || return 1
  [[ "$expected_uid" =~ ^[1-9][0-9]*$ ]] || return 1
  if [[ "$mode" == 'apply' ]]; then
    [[ "$expected_digest" =~ ^[0-9a-f]{64}$ ]] || return 1
    exec {digest_fd}<<<"$expected_digest" || return 1
  else
    digest_fd='-'
  fi
  if env -i PATH="$SAFE_PATH" python3 -I - \
    "$mode" "$incoming" "$SECRET_ROOT" "$expected_uid" "$digest_fd" <<'PY'
import hashlib
import os
import re
import stat
import sys

FILES = {
    'api-action-capability-hmac': (10001, 10001, 0o400),
    'api-action-payload-hmac': (10001, 10001, 0o400),
    'api-action-semantic-hmac': (10001, 10001, 0o400),
    'api-action-transport-hmac': (10001, 10001, 0o400),
    'beta-database-url': (10001, 10001, 0o400),
    'beta-payload-hmac': (10001, 10001, 0o400),
    'beta-transport-hmac': (10001, 10001, 0o400),
    'bot-action-transport-hmac': (10001, 10001, 0o400),
    'bot-token': (10001, 10001, 0o400),
    'bot-transport-hmac': (10001, 10001, 0o400),
    'cbe-deposit-reference-encryption-key': (10001, 10001, 0o400),
    'cbe-deposit-reference-fingerprint-key': (10001, 10001, 0o400),
    'cbe-deposit-reference-key-profile.v1.json': (0, 0, 0o444),
    'customer-web-database-url': (10001, 10001, 0o400),
    'customer-web-publishable-key': (10001, 10001, 0o400),
    'customer-web-rate-limit-hmac': (10001, 10001, 0o400),
    'deposit-proof-reference-encryption-master': (10001, 10001, 0o400),
    'deposit-proof-reference-fingerprint-master': (10001, 10001, 0o400),
    'deposit-proof-reference-profile.v2.json': (0, 0, 0o444),
    'owner-database-url': (10001, 10001, 0o400),
    'player-action-database-url': (10001, 10001, 0o400),
    'publishable-key': (10001, 10001, 0o400),
    'supabase-ca.crt': (0, 0, 0o444),
}
DIGEST = re.compile(r'[0-9a-f]{64}')
TARGET_TEMP_SUFFIX = '.kemerbet-v1-reinstall.installing'
MAX_FILE_BYTES = 131072
MAX_TOTAL_BYTES = 524288


def reject():
    raise RuntimeError()


def exact_mode(value):
    return stat.S_IMODE(value.st_mode)


def read_all(descriptor, maximum):
    chunks = []
    size = 0
    while True:
        chunk = os.read(descriptor, min(65536, maximum + 1 - size))
        if not chunk:
            break
        size += len(chunk)
        if size > maximum:
            reject()
        chunks.append(chunk)
    return b''.join(chunks)


def target_temporary_names(target_fd):
    names = []
    for entry in os.listdir(target_fd):
        if not entry.endswith(TARGET_TEMP_SUFFIX):
            continue
        if not entry.startswith('.'):
            reject()
        source_name = entry[1:-len(TARGET_TEMP_SUFFIX)]
        if source_name not in FILES or entry != f'.{source_name}{TARGET_TEMP_SUFFIX}':
            reject()
        names.append((entry, source_name))
    return sorted(names)


def normalize_target_temporaries(target_fd, action):
    temporaries = target_temporary_names(target_fd)
    if temporaries and action == 'require-absent':
        reject()
    for temporary, name in temporaries:
        owner_uid, owner_gid, mode = FILES[name]
        temporary_stat = os.stat(temporary, dir_fd=target_fd, follow_symlinks=False)
        try:
            target_stat = os.stat(name, dir_fd=target_fd, follow_symlinks=False)
        except FileNotFoundError:
            target_stat = None
        if (
            not stat.S_ISREG(temporary_stat.st_mode)
            or temporary_stat.st_nlink not in (1, 2)
            or temporary_stat.st_size > MAX_FILE_BYTES
        ):
            reject()
        if temporary_stat.st_nlink == 2:
            if target_stat is None or (
                not stat.S_ISREG(target_stat.st_mode)
                or (target_stat.st_dev, target_stat.st_ino) !=
                (temporary_stat.st_dev, temporary_stat.st_ino)
                or target_stat.st_uid != owner_uid
                or target_stat.st_gid != owner_gid
                or exact_mode(target_stat) != mode
                or target_stat.st_nlink != 2
            ):
                reject()
        else:
            if target_stat is not None:
                reject()
            root_partial = (
                temporary_stat.st_uid == 0
                and temporary_stat.st_gid == 0
                and exact_mode(temporary_stat) == 0o600
            )
            installed_partial = (
                temporary_stat.st_uid == owner_uid
                and temporary_stat.st_gid == owner_gid
                and exact_mode(temporary_stat) == mode
            )
            if not root_partial and not installed_partial:
                reject()
        if action == 'purge':
            os.unlink(temporary, dir_fd=target_fd)
            os.fsync(target_fd)
        if action == 'purge' and target_stat is not None:
            normalized = os.stat(name, dir_fd=target_fd, follow_symlinks=False)
            if (
                (normalized.st_dev, normalized.st_ino) !=
                (target_stat.st_dev, target_stat.st_ino)
                or normalized.st_uid != owner_uid
                or normalized.st_gid != owner_gid
                or exact_mode(normalized) != mode
                or normalized.st_nlink != 1
            ):
                reject()
    if action == 'purge' and target_temporary_names(target_fd):
        reject()
    return len(temporaries)


def open_directory(path, expected_uid=None, exact_directory_mode=None):
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC
    if hasattr(os, 'O_NOFOLLOW'):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags)
    opened = os.fstat(descriptor)
    if not stat.S_ISDIR(opened.st_mode):
        reject()
    if expected_uid is not None and opened.st_uid != expected_uid:
        reject()
    if exact_directory_mode is not None and exact_mode(opened) != exact_directory_mode:
        reject()
    if expected_uid is None and (opened.st_uid != 0 or opened.st_gid != 0):
        reject()
    if expected_uid is None and exact_mode(opened) & 0o022:
        reject()
    if os.path.realpath(path) != path:
        reject()
    return descriptor, opened


def source_bundle(source_fd, source_uid):
    names = sorted(os.listdir(source_fd))
    if names != sorted(FILES):
        reject()
    result = {}
    total = 0
    aggregate = hashlib.sha256()
    for name in names:
        before = os.stat(name, dir_fd=source_fd, follow_symlinks=False)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_uid != source_uid
            or exact_mode(before) != 0o600
            or before.st_nlink != 1
            or before.st_size <= 0
            or before.st_size > MAX_FILE_BYTES
        ):
            reject()
        flags = os.O_RDONLY | os.O_CLOEXEC
        if hasattr(os, 'O_NOFOLLOW'):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(name, flags, dir_fd=source_fd)
        try:
            opened = os.fstat(descriptor)
            if (
                (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino)
                or opened.st_mode != before.st_mode
                or opened.st_uid != before.st_uid
                or opened.st_gid != before.st_gid
                or opened.st_nlink != before.st_nlink
                or opened.st_size != before.st_size
            ):
                reject()
            content = read_all(descriptor, MAX_FILE_BYTES)
            if len(content) != before.st_size:
                reject()
        finally:
            os.close(descriptor)
        after = os.stat(name, dir_fd=source_fd, follow_symlinks=False)
        if (
            after.st_mode != before.st_mode
            or after.st_uid != before.st_uid
            or after.st_gid != before.st_gid
            or after.st_nlink != before.st_nlink
            or after.st_size != before.st_size
            or (after.st_dev, after.st_ino) != (before.st_dev, before.st_ino)
        ):
            reject()
        total += len(content)
        if total > MAX_TOTAL_BYTES:
            reject()
        content_digest = hashlib.sha256(content).digest()
        encoded_name = name.encode('ascii')
        aggregate.update(len(encoded_name).to_bytes(2, 'big'))
        aggregate.update(encoded_name)
        aggregate.update(len(content).to_bytes(8, 'big'))
        aggregate.update(content_digest)
        result[name] = (content, before)
    return aggregate.hexdigest(), result


def exact_target(target_fd, name, content, owner_uid, owner_gid, mode):
    temporary = f'.{name}.kemerbet-v1-reinstall.installing'
    try:
        target_stat = os.stat(name, dir_fd=target_fd, follow_symlinks=False)
    except FileNotFoundError:
        target_stat = None
    try:
        temporary_stat = os.stat(temporary, dir_fd=target_fd, follow_symlinks=False)
    except FileNotFoundError:
        temporary_stat = None
    if target_stat is not None:
        if (
            not stat.S_ISREG(target_stat.st_mode)
            or target_stat.st_uid != owner_uid
            or target_stat.st_gid != owner_gid
            or exact_mode(target_stat) != mode
            or target_stat.st_size != len(content)
            or target_stat.st_nlink not in (1, 2)
        ):
            reject()
        if target_stat.st_nlink == 2:
            if temporary_stat is None or (
                (temporary_stat.st_dev, temporary_stat.st_ino) !=
                (target_stat.st_dev, target_stat.st_ino)
            ):
                reject()
            os.unlink(temporary, dir_fd=target_fd)
            os.fsync(target_fd)
            target_stat = os.stat(name, dir_fd=target_fd, follow_symlinks=False)
        elif temporary_stat is not None:
            reject()
        flags = os.O_RDONLY | os.O_CLOEXEC
        if hasattr(os, 'O_NOFOLLOW'):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(name, flags, dir_fd=target_fd)
        try:
            opened = os.fstat(descriptor)
            observed = read_all(descriptor, MAX_FILE_BYTES)
        finally:
            os.close(descriptor)
        if (
            (opened.st_dev, opened.st_ino) != (target_stat.st_dev, target_stat.st_ino)
            or opened.st_mode != target_stat.st_mode
            or opened.st_uid != target_stat.st_uid
            or opened.st_gid != target_stat.st_gid
            or opened.st_nlink != 1
            or observed != content
        ):
            reject()
        return
    if temporary_stat is not None:
        if not stat.S_ISREG(temporary_stat.st_mode) or temporary_stat.st_nlink != 1:
            reject()
        root_partial = (
            temporary_stat.st_uid == 0
            and temporary_stat.st_gid == 0
            and exact_mode(temporary_stat) == 0o600
            and temporary_stat.st_size <= MAX_FILE_BYTES
        )
        completed_temporary = (
            temporary_stat.st_uid == owner_uid
            and temporary_stat.st_gid == owner_gid
            and exact_mode(temporary_stat) == mode
            and temporary_stat.st_size == len(content)
        )
        if completed_temporary:
            flags = os.O_RDONLY | os.O_CLOEXEC
            if hasattr(os, 'O_NOFOLLOW'):
                flags |= os.O_NOFOLLOW
            descriptor = os.open(temporary, flags, dir_fd=target_fd)
            try:
                completed_temporary = read_all(descriptor, MAX_FILE_BYTES) == content
            finally:
                os.close(descriptor)
        if not root_partial and not completed_temporary:
            reject()
        os.unlink(temporary, dir_fd=target_fd)
        os.fsync(target_fd)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC
    if hasattr(os, 'O_NOFOLLOW'):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(temporary, flags, 0o600, dir_fd=target_fd)
    try:
        offset = 0
        while offset < len(content):
            written = os.write(descriptor, content[offset:])
            if written <= 0:
                reject()
            offset += written
        os.fsync(descriptor)
        os.fchown(descriptor, owner_uid, owner_gid)
        os.fchmod(descriptor, mode)
        os.fsync(descriptor)
        installed = os.fstat(descriptor)
        if (
            not stat.S_ISREG(installed.st_mode)
            or installed.st_uid != owner_uid
            or installed.st_gid != owner_gid
            or exact_mode(installed) != mode
            or installed.st_nlink != 1
            or installed.st_size != len(content)
        ):
            reject()
    finally:
        os.close(descriptor)
    os.link(
        temporary,
        name,
        src_dir_fd=target_fd,
        dst_dir_fd=target_fd,
        follow_symlinks=False,
    )
    os.unlink(temporary, dir_fd=target_fd)
    os.fsync(target_fd)
    exact_target(target_fd, name, content, owner_uid, owner_gid, mode)


def target_bundle(target_fd):
    if target_temporary_names(target_fd):
        reject()
    total = 0
    aggregate = hashlib.sha256()
    for name in sorted(FILES):
        owner_uid, owner_gid, mode = FILES[name]
        before = os.stat(name, dir_fd=target_fd, follow_symlinks=False)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_uid != owner_uid
            or before.st_gid != owner_gid
            or exact_mode(before) != mode
            or before.st_nlink != 1
            or before.st_size <= 0
            or before.st_size > MAX_FILE_BYTES
        ):
            reject()
        flags = os.O_RDONLY | os.O_CLOEXEC
        if hasattr(os, 'O_NOFOLLOW'):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(name, flags, dir_fd=target_fd)
        try:
            opened = os.fstat(descriptor)
            if (
                (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino)
                or opened.st_mode != before.st_mode
                or opened.st_uid != before.st_uid
                or opened.st_gid != before.st_gid
                or opened.st_nlink != before.st_nlink
                or opened.st_size != before.st_size
            ):
                reject()
            content = read_all(descriptor, MAX_FILE_BYTES)
        finally:
            os.close(descriptor)
        after = os.stat(name, dir_fd=target_fd, follow_symlinks=False)
        if (
            after.st_mode != before.st_mode
            or after.st_uid != before.st_uid
            or after.st_gid != before.st_gid
            or after.st_nlink != before.st_nlink
            or after.st_size != before.st_size
            or (after.st_dev, after.st_ino) != (before.st_dev, before.st_ino)
            or len(content) != before.st_size
        ):
            reject()
        total += len(content)
        if total > MAX_TOTAL_BYTES:
            reject()
        content_digest = hashlib.sha256(content).digest()
        encoded_name = name.encode('ascii')
        aggregate.update(len(encoded_name).to_bytes(2, 'big'))
        aggregate.update(encoded_name)
        aggregate.update(len(content).to_bytes(8, 'big'))
        aggregate.update(content_digest)
    return aggregate.hexdigest()


def classify_reset_targets(target_fd):
    temporary_count = normalize_target_temporaries(target_fd, 'classify')
    present = temporary_count > 0
    total = 0
    for name in sorted(FILES):
        owner_uid, owner_gid, expected_mode = FILES[name]
        try:
            before = os.stat(name, dir_fd=target_fd, follow_symlinks=False)
        except FileNotFoundError:
            continue
        present = True
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_uid != owner_uid
            or before.st_gid != owner_gid
            or exact_mode(before) != expected_mode
            or before.st_nlink not in (1, 2)
            or before.st_size <= 0
            or before.st_size > MAX_FILE_BYTES
        ):
            reject()
        if before.st_nlink == 2:
            temporary = f'.{name}{TARGET_TEMP_SUFFIX}'
            temporary_stat = os.stat(
                temporary,
                dir_fd=target_fd,
                follow_symlinks=False,
            )
            if (
                (temporary_stat.st_dev, temporary_stat.st_ino)
                != (before.st_dev, before.st_ino)
                or temporary_stat.st_nlink != 2
            ):
                reject()
        flags = os.O_RDONLY | os.O_CLOEXEC
        if hasattr(os, 'O_NOFOLLOW'):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(name, flags, dir_fd=target_fd)
        try:
            opened = os.fstat(descriptor)
            content = read_all(descriptor, MAX_FILE_BYTES)
        finally:
            os.close(descriptor)
        after = os.stat(name, dir_fd=target_fd, follow_symlinks=False)
        for observed in (opened, after):
            if (
                observed.st_mode != before.st_mode
                or observed.st_uid != before.st_uid
                or observed.st_gid != before.st_gid
                or observed.st_nlink != before.st_nlink
                or observed.st_size != before.st_size
                or (observed.st_dev, observed.st_ino) != (before.st_dev, before.st_ino)
            ):
                reject()
        if len(content) != before.st_size:
            reject()
        total += len(content)
        if total > MAX_TOTAL_BYTES:
            reject()
    return 'present' if present else 'absent'


def read_expected_digest(descriptor_text):
    if not descriptor_text.isascii() or not descriptor_text.isdecimal():
        reject()
    descriptor = int(descriptor_text, 10)
    if descriptor < 3 or descriptor > 1024:
        reject()
    try:
        content = os.read(descriptor, 66)
    finally:
        os.close(descriptor)
    if len(content) != 65 or content[-1:] != b'\n':
        reject()
    value = content[:-1].decode('ascii')
    if not DIGEST.fullmatch(value):
        reject()
    return value


try:
    if len(sys.argv) != 6 or sys.argv[1] not in (
        'inspect',
        'apply',
        'verify-targets',
        'inspect-target-temps',
        'classify-target-temps',
        'purge-target-temps',
        'classify-reset-targets',
    ):
        reject()
    mode, source, target, source_uid_text, digest_fd_text = sys.argv[1:]
    if not source_uid_text.isascii() or not source_uid_text.isdecimal():
        reject()
    source_uid = int(source_uid_text, 10)
    if mode in (
        'verify-targets',
        'inspect-target-temps',
        'classify-target-temps',
        'purge-target-temps',
        'classify-reset-targets',
    ):
        if source != '-' or digest_fd_text != '-':
            reject()
        target_fd, target_root_before = open_directory(target)
        try:
            if mode == 'verify-targets':
                sys.stdout.write(target_bundle(target_fd) + '\n')
            elif mode == 'classify-reset-targets':
                sys.stdout.write(classify_reset_targets(target_fd) + '\n')
            else:
                action = {
                    'inspect-target-temps': 'require-absent',
                    'classify-target-temps': 'classify',
                    'purge-target-temps': 'purge',
                }[mode]
                count = normalize_target_temporaries(target_fd, action)
                if mode == 'classify-target-temps':
                    sys.stdout.write(('present' if count else 'absent') + '\n')
            target_root_after = os.fstat(target_fd)
            if (
                target_root_after.st_mode != target_root_before.st_mode
                or target_root_after.st_uid != target_root_before.st_uid
                or target_root_after.st_gid != target_root_before.st_gid
                or (target_root_after.st_dev, target_root_after.st_ino) !=
                (target_root_before.st_dev, target_root_before.st_ino)
            ):
                reject()
        finally:
            os.close(target_fd)
    else:
        source_fd, source_root_before = open_directory(source, source_uid, 0o700)
        try:
            bundle_digest, sources = source_bundle(source_fd, source_uid)
            if mode == 'inspect':
                if digest_fd_text != '-':
                    reject()
                sys.stdout.write(bundle_digest + '\n')
            else:
                if bundle_digest != read_expected_digest(digest_fd_text):
                    reject()
                target_fd, target_root_before = open_directory(target)
                try:
                    for name in sorted(FILES):
                        exact_target(target_fd, name, sources[name][0], *FILES[name])
                    os.fsync(target_fd)
                    if target_bundle(target_fd) != bundle_digest:
                        reject()
                    target_root_after = os.fstat(target_fd)
                    if (
                        target_root_after.st_mode != target_root_before.st_mode
                        or target_root_after.st_uid != target_root_before.st_uid
                        or target_root_after.st_gid != target_root_before.st_gid
                        or (target_root_after.st_dev, target_root_after.st_ino) !=
                        (target_root_before.st_dev, target_root_before.st_ino)
                    ):
                        reject()
                finally:
                    os.close(target_fd)
                bundle_after, _ = source_bundle(source_fd, source_uid)
                if bundle_after != bundle_digest:
                    reject()
            source_root_after = os.fstat(source_fd)
            if (
                source_root_after.st_mode != source_root_before.st_mode
                or source_root_after.st_uid != source_root_before.st_uid
                or source_root_after.st_gid != source_root_before.st_gid
                or (source_root_after.st_dev, source_root_after.st_ino) !=
                (source_root_before.st_dev, source_root_before.st_ino)
            ):
                reject()
        finally:
            os.close(source_fd)
except Exception:
    raise SystemExit(1)
PY
  then
    python_status=0
  else
    python_status=$?
  fi
  if [[ "$mode" == 'apply' ]]; then
    exec {digest_fd}<&- || return 1
  fi
  return "$python_status"
}

require_kemerbet_v1_reinstall_target_temps_absent() {
  if [[ ! -e "$SECRET_ROOT" && ! -L "$SECRET_ROOT" ]]; then
    return 0
  fi
  kemerbet_v1_retirement_secret_bundle inspect-target-temps - >/dev/null 2>&1
}

classify_kemerbet_v1_reinstall_target_temps() {
  if [[ ! -e "$SECRET_ROOT" && ! -L "$SECRET_ROOT" ]]; then
    printf '%s\n' absent
    return 0
  fi
  kemerbet_v1_retirement_secret_bundle classify-target-temps - 2>/dev/null
}

purge_kemerbet_v1_reinstall_target_temps() {
  if [[ ! -e "$SECRET_ROOT" && ! -L "$SECRET_ROOT" ]]; then
    return 0
  fi
  kemerbet_v1_retirement_secret_bundle purge-target-temps - >/dev/null 2>&1
}

stage_kemerbet_v1_reinstall_input_for_removal() {
  local incoming="$1" consumed="$2" expected_uid
  expected_uid="$(id -u "$EXPECTED_SUDO_USER")" || return 1
  [[ "$expected_uid" =~ ^[1-9][0-9]*$ ]] || return 1
  env -i PATH="$SAFE_PATH" python3 -I - "/tmp" "$incoming" "$consumed" "$expected_uid" <<'PY'
import ctypes
import errno
import os
import stat
import sys


def reject():
    raise RuntimeError()


try:
    if len(sys.argv) != 5:
        reject()
    parent, source, consumed, expected_uid_text = sys.argv[1:]
    if not expected_uid_text.isascii() or not expected_uid_text.isdecimal():
        reject()
    expected_uid = int(expected_uid_text, 10)
    source_name = os.path.basename(source)
    consumed_name = os.path.basename(consumed)
    if (
        os.path.dirname(source) != parent
        or os.path.dirname(consumed) != parent
        or not source_name.startswith('fetanagent-kemerbet-v1-retirement-secrets-')
        or consumed_name != source_name + '.consumed'
        or '/' in source_name
        or '/' in consumed_name
    ):
        reject()
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC
    if hasattr(os, 'O_NOFOLLOW'):
        flags |= os.O_NOFOLLOW
    parent_fd = os.open(parent, flags)
    try:
        parent_before = os.fstat(parent_fd)
        if (
            not stat.S_ISDIR(parent_before.st_mode)
            or parent_before.st_uid != 0
            or parent_before.st_gid != 0
            or stat.S_IMODE(parent_before.st_mode) != 0o1777
            or os.path.realpath(parent) != parent
        ):
            reject()
        try:
            source_before = os.stat(source_name, dir_fd=parent_fd, follow_symlinks=False)
        except FileNotFoundError:
            source_before = None
        try:
            consumed_before = os.stat(consumed_name, dir_fd=parent_fd, follow_symlinks=False)
        except FileNotFoundError:
            consumed_before = None
        if source_before is not None:
            if consumed_before is not None:
                reject()
            if (
                not stat.S_ISDIR(source_before.st_mode)
                or source_before.st_uid != expected_uid
                or stat.S_IMODE(source_before.st_mode) != 0o700
            ):
                reject()
            libc = ctypes.CDLL(None, use_errno=True)
            renameat2 = libc.renameat2
            renameat2.argtypes = [
                ctypes.c_int,
                ctypes.c_char_p,
                ctypes.c_int,
                ctypes.c_char_p,
                ctypes.c_uint,
            ]
            renameat2.restype = ctypes.c_int
            if renameat2(
                parent_fd,
                os.fsencode(source_name),
                parent_fd,
                os.fsencode(consumed_name),
                1,
            ) != 0:
                error = ctypes.get_errno()
                if error in (errno.EEXIST, errno.ENOTEMPTY):
                    reject()
                raise OSError(error, os.strerror(error))
            os.fsync(parent_fd)
        elif consumed_before is None:
            reject()
        consumed_after = os.stat(consumed_name, dir_fd=parent_fd, follow_symlinks=False)
        if (
            not stat.S_ISDIR(consumed_after.st_mode)
            or consumed_after.st_uid != expected_uid
            or stat.S_IMODE(consumed_after.st_mode) != 0o700
        ):
            reject()
        try:
            os.stat(source_name, dir_fd=parent_fd, follow_symlinks=False)
            reject()
        except FileNotFoundError:
            pass
        parent_after = os.fstat(parent_fd)
        if (
            parent_after.st_mode != parent_before.st_mode
            or parent_after.st_uid != parent_before.st_uid
            or parent_after.st_gid != parent_before.st_gid
            or (parent_after.st_dev, parent_after.st_ino) !=
            (parent_before.st_dev, parent_before.st_ino)
        ):
            reject()
    finally:
        os.close(parent_fd)
except Exception:
    raise SystemExit(1)
PY
}

list_kemerbet_v1_reinstall_input_residues() {
  find -P /tmp -regextype posix-extended -mindepth 1 -maxdepth 1 \
    -regex '/tmp/fetanagent-kemerbet-v1-retirement-secrets-[0-9a-f]{40}(\.consumed)?' \
    -print | LC_ALL=C sort
}

kemerbet_v1_reinstall_input_residue() {
  local mode="$1" path="$2" expected_uid
  [[ "$mode" == 'inspect' || "$mode" == 'purge' ]] || return 1
  expected_uid="$(id -u "$EXPECTED_SUDO_USER")" || return 1
  [[ "$expected_uid" =~ ^[1-9][0-9]*$ ]] || return 1
  env -i PATH="$SAFE_PATH" python3 -I - "$mode" "$path" "$expected_uid" <<'PY'
import os
import re
import stat
import sys


FILES = {
    'api-action-capability-hmac',
    'api-action-payload-hmac',
    'api-action-semantic-hmac',
    'api-action-transport-hmac',
    'beta-database-url',
    'beta-payload-hmac',
    'beta-transport-hmac',
    'bot-action-transport-hmac',
    'bot-token',
    'bot-transport-hmac',
    'cbe-deposit-reference-encryption-key',
    'cbe-deposit-reference-fingerprint-key',
    'cbe-deposit-reference-key-profile.v1.json',
    'customer-web-database-url',
    'customer-web-publishable-key',
    'customer-web-rate-limit-hmac',
    'deposit-proof-reference-encryption-master',
    'deposit-proof-reference-fingerprint-master',
    'deposit-proof-reference-profile.v2.json',
    'owner-database-url',
    'player-action-database-url',
    'publishable-key',
    'supabase-ca.crt',
}
NAME = re.compile(
    r'fetanagent-kemerbet-v1-retirement-secrets-[0-9a-f]{40}(?:\.consumed)?'
)
MAX_FILE_BYTES = 131072
MAX_TOTAL_BYTES = 524288


def reject():
    raise RuntimeError()


def inode_identity(value):
    return (
        value.st_dev,
        value.st_ino,
        value.st_mode,
        value.st_uid,
        value.st_gid,
        value.st_nlink,
        value.st_size,
    )


try:
    if len(sys.argv) != 4:
        reject()
    mode, path, expected_uid_text = sys.argv[1:]
    if mode not in {'inspect', 'purge'}:
        reject()
    if not expected_uid_text.isascii() or not expected_uid_text.isdecimal():
        reject()
    expected_uid = int(expected_uid_text, 10)
    parent = '/tmp'
    name = os.path.basename(path)
    if os.path.dirname(path) != parent or NAME.fullmatch(name) is None:
        reject()
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC
    if hasattr(os, 'O_NOFOLLOW'):
        flags |= os.O_NOFOLLOW
    parent_fd = os.open(parent, flags)
    try:
        parent_before = os.fstat(parent_fd)
        if (
            not stat.S_ISDIR(parent_before.st_mode)
            or parent_before.st_uid != 0
            or parent_before.st_gid != 0
            or stat.S_IMODE(parent_before.st_mode) != 0o1777
            or os.path.realpath(parent) != parent
        ):
            reject()
        root_before = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        if (
            not stat.S_ISDIR(root_before.st_mode)
            or root_before.st_uid != expected_uid
            or stat.S_IMODE(root_before.st_mode) != 0o700
            or root_before.st_dev != parent_before.st_dev
        ):
            reject()
        root_fd = os.open(name, flags, dir_fd=parent_fd)
        try:
            root_opened = os.fstat(root_fd)
            if inode_identity(root_opened) != inode_identity(root_before):
                reject()
            names = sorted(os.listdir(root_fd))
            if not set(names).issubset(FILES):
                reject()
            identities = {}
            total = 0
            for entry in names:
                before = os.stat(entry, dir_fd=root_fd, follow_symlinks=False)
                if (
                    not stat.S_ISREG(before.st_mode)
                    or before.st_uid != expected_uid
                    or stat.S_IMODE(before.st_mode) != 0o600
                    or before.st_nlink != 1
                    or before.st_size <= 0
                    or before.st_size > MAX_FILE_BYTES
                    or before.st_dev != root_before.st_dev
                ):
                    reject()
                file_flags = os.O_RDONLY | os.O_CLOEXEC
                if hasattr(os, 'O_NOFOLLOW'):
                    file_flags |= os.O_NOFOLLOW
                descriptor = os.open(entry, file_flags, dir_fd=root_fd)
                try:
                    opened = os.fstat(descriptor)
                    if inode_identity(opened) != inode_identity(before):
                        reject()
                    size = 0
                    while True:
                        chunk = os.read(descriptor, min(65536, MAX_FILE_BYTES + 1 - size))
                        if not chunk:
                            break
                        size += len(chunk)
                        if size > MAX_FILE_BYTES:
                            reject()
                    if size != before.st_size:
                        reject()
                finally:
                    os.close(descriptor)
                after = os.stat(entry, dir_fd=root_fd, follow_symlinks=False)
                if inode_identity(after) != inode_identity(before):
                    reject()
                identities[entry] = inode_identity(before)
                total += size
                if total > MAX_TOTAL_BYTES:
                    reject()
            root_after_inspect = os.fstat(root_fd)
            if inode_identity(root_after_inspect) != inode_identity(root_before):
                reject()
            if mode == 'inspect':
                sys.stdout.write(('complete' if set(names) == FILES else 'partial') + '\n')
            else:
                for entry in names:
                    current = os.stat(entry, dir_fd=root_fd, follow_symlinks=False)
                    if inode_identity(current) != identities[entry]:
                        reject()
                    os.unlink(entry, dir_fd=root_fd)
                os.fsync(root_fd)
                if os.listdir(root_fd):
                    reject()
                root_after_remove = os.fstat(root_fd)
                if (
                    root_after_remove.st_dev != root_before.st_dev
                    or root_after_remove.st_ino != root_before.st_ino
                    or root_after_remove.st_mode != root_before.st_mode
                    or root_after_remove.st_uid != root_before.st_uid
                    or root_after_remove.st_gid != root_before.st_gid
                ):
                    reject()
        finally:
            os.close(root_fd)
        root_before_rmdir = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        if (
            root_before_rmdir.st_dev != root_before.st_dev
            or root_before_rmdir.st_ino != root_before.st_ino
            or root_before_rmdir.st_mode != root_before.st_mode
            or root_before_rmdir.st_uid != root_before.st_uid
            or root_before_rmdir.st_gid != root_before.st_gid
        ):
            reject()
        if mode == 'purge':
            os.rmdir(name, dir_fd=parent_fd)
            os.fsync(parent_fd)
            try:
                os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
                reject()
            except FileNotFoundError:
                pass
        parent_after = os.fstat(parent_fd)
        if (
            parent_after.st_dev != parent_before.st_dev
            or parent_after.st_ino != parent_before.st_ino
            or parent_after.st_mode != parent_before.st_mode
            or parent_after.st_uid != parent_before.st_uid
            or parent_after.st_gid != parent_before.st_gid
        ):
            reject()
    finally:
        os.close(parent_fd)
except Exception:
    raise SystemExit(1)
PY
}

remove_kemerbet_v1_reinstall_input_residues_best_effort() {
  local cleanup_status=0 path residues
  if ! residues="$(list_kemerbet_v1_reinstall_input_residues)"; then
    return 1
  fi
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    kemerbet_v1_reinstall_input_residue purge "$path" || cleanup_status=1
  done <<<"$residues"
  if ! residues="$(list_kemerbet_v1_reinstall_input_residues)"; then
    cleanup_status=1
  elif [[ -n "$residues" ]]; then
    cleanup_status=1
  fi
  return "$cleanup_status"
}

KEMERBET_V1_REINSTALL_RESIDUE_PATH=''
KEMERBET_V1_REINSTALL_RESIDUE_BUNDLE_SHA256=''
KEMERBET_V1_REINSTALL_RESIDUE_COMPLETE='false'

inspect_kemerbet_v1_reinstall_residue() {
  local commit_sha="$1" consumed incoming observed_paths shape
  KEMERBET_V1_REINSTALL_RESIDUE_PATH=''
  KEMERBET_V1_REINSTALL_RESIDUE_BUNDLE_SHA256=''
  KEMERBET_V1_REINSTALL_RESIDUE_COMPLETE='false'
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || return 2
  incoming="/tmp/fetanagent-kemerbet-v1-retirement-secrets-$commit_sha"
  consumed="${incoming}.consumed"
  observed_paths="$(list_kemerbet_v1_reinstall_input_residues)" || return 2
  if [[ -z "$observed_paths" ]]; then
    return 1
  fi
  if [[ "$observed_paths" == "$incoming" ]]; then
    KEMERBET_V1_REINSTALL_RESIDUE_PATH="$incoming"
  elif [[ "$observed_paths" == "$consumed" ]]; then
    KEMERBET_V1_REINSTALL_RESIDUE_PATH="$consumed"
  else
    return 2
  fi
  shape="$(kemerbet_v1_reinstall_input_residue inspect \
    "$KEMERBET_V1_REINSTALL_RESIDUE_PATH")" || return 2
  [[ "$shape" == 'complete' || "$shape" == 'partial' ]] || return 2
  if [[ "$shape" == 'complete' ]]; then
    KEMERBET_V1_REINSTALL_RESIDUE_BUNDLE_SHA256="$(
      kemerbet_v1_retirement_secret_bundle inspect "$KEMERBET_V1_REINSTALL_RESIDUE_PATH"
    )" || return 2
    [[ "$KEMERBET_V1_REINSTALL_RESIDUE_BUNDLE_SHA256" =~ ^[0-9a-f]{64}$ ]] || return 2
    KEMERBET_V1_REINSTALL_RESIDUE_COMPLETE='true'
  fi
  return 0
}

KEMERBET_V1_RETIREMENT_GATE_STATE='absent'
KEMERBET_V1_RETIREMENT_GATE_RELEASE=''

inspect_kemerbet_v1_retirement_gate() {
  local archive_installing context_digest installer_intent intent_installing entries residue_paths
  local target_temp_state
  KEMERBET_V1_RETIREMENT_GATE_STATE='absent'
  KEMERBET_V1_RETIREMENT_GATE_RELEASE=''
  if [[ -e "$KEMERBET_READINESS_OUTPUT_ROOT" || -L "$KEMERBET_READINESS_OUTPUT_ROOT" ]]; then
    if ! normalize_kemerbet_readiness_binding_publication; then
      KEMERBET_V1_RETIREMENT_GATE_STATE='invalid'
      return 0
    fi
  fi
  target_temp_state="$(classify_kemerbet_v1_reinstall_target_temps)" || {
    KEMERBET_V1_RETIREMENT_GATE_STATE='invalid'
    return 0
  }
  [[ "$target_temp_state" == 'absent' || "$target_temp_state" == 'present' ]] || {
    KEMERBET_V1_RETIREMENT_GATE_STATE='invalid'
    return 0
  }
  residue_paths="$(list_kemerbet_v1_reinstall_input_residues)" || {
    KEMERBET_V1_RETIREMENT_GATE_STATE='invalid'
    return 0
  }
  if [[ -e "$KEMERBET_V1_REINSTALL_JOURNAL" || -L "$KEMERBET_V1_REINSTALL_JOURNAL" ||
    -e "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" ||
    -L "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" ]]; then
    KEMERBET_V1_RETIREMENT_GATE_STATE='invalid'
    [[ ! -e "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" &&
      ! -L "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" &&
      ! -L "$KEMERBET_V1_RETIREMENT_ROOT" && -d "$KEMERBET_V1_RETIREMENT_ROOT" ]] ||
      return 0
    read_kemerbet_v1_retirement_intent_metadata || return 0
    KEMERBET_V1_RETIREMENT_GATE_RELEASE="$KEMERBET_V1_RETIREMENT_RELEASE"
    if [[ -n "$residue_paths" ]]; then
      inspect_kemerbet_v1_reinstall_residue "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" ||
        return 0
    fi
    if [[ -e "$KEMERBET_V1_REINSTALL_JOURNAL" || -L "$KEMERBET_V1_REINSTALL_JOURNAL" ]]; then
      read_kemerbet_v1_reinstall_journal || return 0
      [[ "$KEMERBET_V1_REINSTALL_RELEASE" == "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" ]] ||
        return 0
      if [[ -e "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" ||
        -L "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" ]]; then
        [[ ! -L "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" &&
          -f "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" &&
          "$(stat --format='%d:%i' "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING")" == \
            "$(stat --format='%d:%i' "$KEMERBET_V1_REINSTALL_JOURNAL")" ]] || return 0
      fi
      context_digest="$(kemerbet_v1_retirement_recovery_context_digest \
        "$KEMERBET_V1_RETIREMENT_GATE_RELEASE")" || return 0
      [[ "$context_digest" == "$KEMERBET_V1_REINSTALL_CONTEXT_SHA256" &&
        "$(kemerbet_v1_retirement_release_asset_digest \
          "$KEMERBET_V1_RETIREMENT_GATE_RELEASE")" == \
          "$KEMERBET_V1_REINSTALL_ASSET_SHA256" ]] || return 0
      KEMERBET_V1_RETIREMENT_GATE_STATE='secrets-reinstall-pending'
      return 0
    fi
    if ! read_kemerbet_v1_reinstall_journal \
      "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING"; then
      require_kemerbet_v1_reinstall_partial_prefix || return 0
      require_kemerbet_v1_retirement_disposable_inputs_absent || return 0
      require_kemerbet_v1_retirement_recovery_topology \
        "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" || return 0
      kemerbet_v1_retirement_release_asset_digest \
        "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" >/dev/null || return 0
      KEMERBET_V1_RETIREMENT_GATE_STATE='secrets-reinstall-prefix-recoverable'
      return 0
    fi
    [[ "$KEMERBET_V1_REINSTALL_RELEASE" == "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" ]] ||
      return 0
    require_kemerbet_v1_retirement_disposable_inputs_absent || return 0
    require_kemerbet_v1_retirement_current_context "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" ||
      return 0
    context_digest="$(kemerbet_v1_retirement_recovery_context_digest \
      "$KEMERBET_V1_RETIREMENT_GATE_RELEASE")" || return 0
    [[ "$context_digest" == "$KEMERBET_V1_REINSTALL_CONTEXT_SHA256" &&
      "$(kemerbet_v1_retirement_release_asset_digest \
        "$KEMERBET_V1_RETIREMENT_GATE_RELEASE")" == \
        "$KEMERBET_V1_REINSTALL_ASSET_SHA256" ]] || return 0
    KEMERBET_V1_RETIREMENT_GATE_STATE='secrets-reinstall-prefix'
    return 0
  fi
  if [[ "$target_temp_state" != 'absent' ]]; then
    KEMERBET_V1_RETIREMENT_GATE_STATE='invalid'
    return 0
  fi
  if [[ ! -e "$KEMERBET_V1_RETIREMENT_ROOT" && ! -L "$KEMERBET_V1_RETIREMENT_ROOT" &&
    ! -e "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" &&
    ! -L "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" ]]; then
    [[ -z "$residue_paths" ]] || KEMERBET_V1_RETIREMENT_GATE_STATE='invalid'
    return 0
  fi
  KEMERBET_V1_RETIREMENT_GATE_STATE='invalid'
  if [[ -e "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" ||
    -L "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" ]]; then
    [[ -z "$residue_paths" ]] || return 0
    [[ ! -e "$KEMERBET_V1_RETIREMENT_ROOT" && ! -L "$KEMERBET_V1_RETIREMENT_ROOT" &&
      ! -L "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" &&
      -d "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" &&
      "$(realpath -- "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING")" == \
        "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" &&
      "$(stat --format='%U:%G:%a' "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING")" == \
        'root:root:700' ]] || return 0
    entries="$(find -P "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" \
      -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" || return 0
    case "$entries" in
      ''|'intent-v1.installing')
        if [[ "$entries" == 'intent-v1.installing' ]]; then
          intent_installing="$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING/intent-v1.installing"
          [[ ! -L "$intent_installing" && -f "$intent_installing" &&
            "$(stat --format='%U:%G:%a:%h' "$intent_installing")" == 'root:root:600:1' &&
            "$(stat --format='%s' "$intent_installing")" -le 4096 ]] || return 0
        fi
        KEMERBET_V1_RETIREMENT_GATE_STATE='prepublish-recoverable'
        return 0
        ;;
      'intent-v1'|$'intent-v1\nintent-v1.installing'|\
        $'archive-v1.installing\nintent-v1'|$'archive-v1\nintent-v1'|\
        $'archive-v1\narchive-v1.installing\nintent-v1') ;;
      *) return 0 ;;
    esac
    installer_intent="$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING/intent-v1"
    read_kemerbet_v1_retirement_intent_metadata \
      "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" "$installer_intent" || return 0
    KEMERBET_V1_RETIREMENT_GATE_RELEASE="$KEMERBET_V1_RETIREMENT_RELEASE"
    require_kemerbet_v1_retirement_current_context "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" \
      "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING" "$installer_intent" || return 0
    intent_installing="$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING/intent-v1.installing"
    if [[ -e "$intent_installing" || -L "$intent_installing" ]]; then
      [[ ! -L "$intent_installing" && -f "$intent_installing" &&
        "$(stat --format='%d:%i' "$intent_installing")" == \
          "$(stat --format='%d:%i' "$installer_intent")" ]] || return 0
    fi
    archive_installing="$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING/archive-v1.installing"
    if [[ -e "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING/archive-v1" ||
      -L "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING/archive-v1" ]]; then
      require_kemerbet_v1_retirement_archive \
        "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING/archive-v1" || return 0
      if [[ -e "$archive_installing" || -L "$archive_installing" ]]; then
        [[ ! -L "$archive_installing" && -f "$archive_installing" &&
          "$(stat --format='%d:%i' "$archive_installing")" == \
            "$(stat --format='%d:%i' "$KEMERBET_V1_RETIREMENT_ROOT_INSTALLING/archive-v1")" ]] ||
          return 0
      fi
    elif [[ -e "$archive_installing" || -L "$archive_installing" ]]; then
      [[ ! -L "$archive_installing" && -f "$archive_installing" &&
        "$(stat --format='%U:%G:%a:%h' "$archive_installing")" == 'root:root:400:1' &&
        "$(stat --format='%s' "$archive_installing")" -le 132 ]] || return 0
    fi
    KEMERBET_V1_RETIREMENT_GATE_STATE='prepublish-recoverable'
    return 0
  fi
  [[ ! -L "$KEMERBET_V1_RETIREMENT_ROOT" && -d "$KEMERBET_V1_RETIREMENT_ROOT" &&
    "$(realpath -- "$KEMERBET_V1_RETIREMENT_ROOT")" == "$KEMERBET_V1_RETIREMENT_ROOT" &&
    "$(stat --format='%U:%G:%a' "$KEMERBET_V1_RETIREMENT_ROOT")" == 'root:root:700' ]] ||
    return 0
  entries="$(find -P "$KEMERBET_V1_RETIREMENT_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" ||
    return 0
  if [[ ! -e "$KEMERBET_V1_RETIREMENT_INTENT" && ! -L "$KEMERBET_V1_RETIREMENT_INTENT" ]]; then
    return 0
  fi
  read_kemerbet_v1_retirement_intent_metadata || return 0
  KEMERBET_V1_RETIREMENT_GATE_RELEASE="$KEMERBET_V1_RETIREMENT_RELEASE"
  if [[ -n "$residue_paths" ]]; then
    inspect_kemerbet_v1_reinstall_residue "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" || return 0
    if require_kemerbet_v1_retirement_recovery_topology \
      "$KEMERBET_V1_RETIREMENT_GATE_RELEASE"; then
      KEMERBET_V1_RETIREMENT_GATE_STATE='secrets-reinstall-residue'
    elif require_kemerbet_v1_retirement_seal_finalization_prefix \
      "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" ||
      { require_kemerbet_v1_retirement_current_context \
          "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" &&
        require_kemerbet_v1_retirement_archive &&
        require_kemerbet_v1_retirement_completed_continuity &&
        [[ "$KEMERBET_V1_RETIREMENT_CONTINUITY_STATE" == \
          'resealed-awaiting-recheck' ]]; }; then
      KEMERBET_V1_RETIREMENT_GATE_STATE='seal-finalization-prefix'
    else
      return 0
    fi
    return 0
  fi
  case "$entries" in
    $'archive-v1\nintent-v1')
      if require_kemerbet_v1_retired_awaiting_v2 \
        "$KEMERBET_V1_RETIREMENT_GATE_RELEASE"; then
        KEMERBET_V1_RETIREMENT_GATE_STATE='pending'
      elif require_kemerbet_v1_retirement_seal_finalization_prefix \
        "$KEMERBET_V1_RETIREMENT_GATE_RELEASE"; then
        KEMERBET_V1_RETIREMENT_GATE_STATE='seal-finalization-prefix'
      elif require_kemerbet_v1_retirement_consume_prefix \
        "$KEMERBET_V1_RETIREMENT_GATE_RELEASE"; then
        KEMERBET_V1_RETIREMENT_GATE_STATE='retirement-consume-prefix'
      else
        return 0
      fi
      ;;
    $'archive-v1\ncompleted-v1.installing\nintent-v1')
      require_kemerbet_v1_retirement_seal_finalization_prefix \
        "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" || return 0
      KEMERBET_V1_RETIREMENT_GATE_STATE='seal-finalization-prefix'
      ;;
    $'archive-v1\ncompleted-v1\nintent-v1'|\
      $'archive-v1\ncompleted-v1\ncompleted-v1.installing\nintent-v1')
      require_kemerbet_v1_retirement_current_context \
        "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" || return 0
      require_kemerbet_v1_retirement_completed_continuity || return 0
      [[ "$KEMERBET_V1_RETIREMENT_CONTINUITY_STATE" == 'resealed-awaiting-recheck' ]] ||
        return 0
      KEMERBET_V1_RETIREMENT_GATE_STATE='seal-finalization-prefix'
      ;;
    $'completed-v1\nintent-v1')
      require_kemerbet_v1_retirement_completed_continuity || return 0
      case "$KEMERBET_V1_RETIREMENT_CONTINUITY_STATE" in
        committed) KEMERBET_V1_RETIREMENT_GATE_STATE='completed' ;;
        resealed-awaiting-recheck)
          require_kemerbet_v1_retirement_current_context \
            "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" || return 0
          KEMERBET_V1_RETIREMENT_GATE_STATE='resealed-awaiting-recheck'
          ;;
        *) return 0 ;;
      esac
      ;;
    *) return 0 ;;
  esac
}

enforce_kemerbet_v1_retirement_gate() {
  local command="$1" commit_sha='' confirmation='' expected_legacy_sha256=''
  inspect_kemerbet_v1_retirement_gate
  case "$KEMERBET_V1_RETIREMENT_GATE_STATE" in
    absent|completed)
      return 0
      ;;
  esac
  case "$command" in
    verify|cutover-ready|fresh-host-ready|network-ready|bot-disabled-ready|public-edge-ready|fresh-public-edge-ready|diagnose-owner-startup|discard|stop|expiry-stop|stop-bot|stop-kemerbet-session-provision|stop-public-edge)
      return 0
      ;;
    retire-kemerbet-readiness-binding-v1-for-v2-reseal)
      commit_sha="${2:-}"
      expected_legacy_sha256="${3:-}"
      confirmation="${4:-}"
      [[ "$KEMERBET_V1_RETIREMENT_GATE_STATE" =~ \
        ^(prepublish-recoverable|retirement-consume-prefix|pending)$ ]] ||
        die 'only an exact unpublished or pending v1 retirement may be resumed explicitly'
      [[ "$expected_legacy_sha256" =~ ^[0-9a-f]{64}$ &&
        "$confirmation" == "$KEMERBET_V1_RETIREMENT_CONFIRMATION" ]] ||
        die 'the exact expected v1 digest and retirement confirmation are required'
      if [[ -n "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" ]]; then
        [[ "$commit_sha" == "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" ]] ||
          die 'the pending v1 retirement is bound to another reviewed release'
        [[ "$expected_legacy_sha256" == "$KEMERBET_V1_RETIREMENT_LEGACY_SHA256" ]] ||
          die 'the pending v1 retirement is bound to another legacy binding digest'
      fi
      if [[ "$KEMERBET_V1_RETIREMENT_GATE_STATE" == 'retirement-consume-prefix' ]]; then
        require_kemerbet_v1_retirement_consume_prefix "$commit_sha" ||
          die 'the published v1 retirement no longer matches its unconsumed legacy binding'
      fi
      return 0
      ;;
    reinstall-kemerbet-v1-retirement-secrets)
      commit_sha="${2:-}"
      [[ "$KEMERBET_V1_RETIREMENT_GATE_STATE" =~ \
          ^(pending|seal-finalization-prefix|resealed-awaiting-recheck|secrets-reinstall-prefix|secrets-reinstall-prefix-recoverable|secrets-reinstall-pending|secrets-reinstall-residue)$ &&
        "$commit_sha" == "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" ]] ||
        die 'runtime secrets may be restored only for the exact durably published v1 retirement release'
      require_kemerbet_v1_retirement_current_context "$commit_sha" ||
        die 'the v1 retirement context changed before runtime-secret recovery'
      if [[ -e "$KEMERBET_V1_RETIREMENT_ARCHIVE" ||
        -L "$KEMERBET_V1_RETIREMENT_ARCHIVE" ]]; then
        require_kemerbet_v1_retirement_archive ||
          die 'runtime-secret recovery requires the exact retired v1 archive'
      else
        require_kemerbet_v1_retirement_completed_continuity &&
          [[ "$KEMERBET_V1_RETIREMENT_CONTINUITY_STATE" == 'resealed-awaiting-recheck' ]] ||
          die 'runtime-secret recovery requires the exact resealed v2 continuity state'
      fi
      return 0
      ;;
    start)
      commit_sha="${2:-}"
      [[ "$KEMERBET_V1_RETIREMENT_GATE_STATE" =~ ^(pending|resealed-awaiting-recheck)$ &&
        "$commit_sha" == "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" ]] ||
        die 'only the exact v1 retirement release may reconstruct the core staging runtime'
      require_kemerbet_v1_retirement_current_context "$commit_sha" ||
        die 'the v1 retirement context changed before same-release runtime recovery'
      kemerbet_v1_retirement_release_asset_digest "$commit_sha" >/dev/null ||
        die 'the same-release Compose or image identity changed before core recovery'
      return 0
      ;;
    arm-expiry-stop)
      commit_sha="${2:-}"
      [[ "$KEMERBET_V1_RETIREMENT_GATE_STATE" =~ ^(pending|resealed-awaiting-recheck)$ &&
        "$commit_sha" == "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" ]] ||
        die 'only the exact v1 retirement release may arm its recovery expiry guard'
      require_kemerbet_v1_retirement_current_context "$commit_sha" ||
        die 'the v1 retirement context changed before arming the recovery expiry guard'
      kemerbet_v1_retirement_release_asset_digest "$commit_sha" >/dev/null ||
        die 'the same-release Compose or image identity changed before expiry recovery'
      require_exact_fresh_private_runtime "$commit_sha"
      [[ ! -e "$BOT_STARTUP_RECEIPT" && ! -L "$BOT_STARTUP_RECEIPT" &&
        ! -e "$BOT_STARTUP_RECEIPT_ROOT" && ! -L "$BOT_STARTUP_RECEIPT_ROOT" ]] ||
        die 'the recovery expiry guard must be armed before Telegram startup'
      return 0
      ;;
    start-bot)
      commit_sha="${2:-}"
      [[ "$KEMERBET_V1_RETIREMENT_GATE_STATE" =~ ^(pending|resealed-awaiting-recheck)$ &&
        "$commit_sha" == "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" ]] ||
        die 'only the exact v1 retirement release may restart Telegram'
      require_kemerbet_v1_retirement_current_context "$commit_sha" ||
        die 'the v1 retirement context changed before Telegram recovery'
      kemerbet_v1_retirement_release_asset_digest "$commit_sha" >/dev/null ||
        die 'the same-release Compose or image identity changed before Telegram recovery'
      require_kemerbet_v1_retirement_expiry_guard_armed ||
        die 'the same-release expiry guard must be armed before Telegram recovery'
      require_exact_fresh_private_runtime "$commit_sha"
      [[ ! -e "$BOT_STARTUP_RECEIPT" && ! -L "$BOT_STARTUP_RECEIPT" &&
        ! -e "$BOT_STARTUP_RECEIPT_ROOT" && ! -L "$BOT_STARTUP_RECEIPT_ROOT" ]] ||
        die 'Telegram recovery requires an empty startup-receipt boundary'
      return 0
      ;;
    bot-ready)
      commit_sha="${2:-}"
      [[ "$KEMERBET_V1_RETIREMENT_GATE_STATE" =~ ^(pending|resealed-awaiting-recheck)$ &&
        "$commit_sha" == "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" ]] ||
        die 'only the exact v1 retirement release may attest Telegram recovery'
      require_kemerbet_v1_retirement_current_context "$commit_sha" ||
        die 'the v1 retirement context changed before Telegram attestation'
      kemerbet_v1_retirement_release_asset_digest "$commit_sha" >/dev/null ||
        die 'the same-release Compose or image identity changed before Telegram attestation'
      require_kemerbet_v1_retirement_expiry_guard_armed ||
        die 'the same-release expiry guard is not armed for Telegram attestation'
      require_exact_fresh_bot_runtime "$commit_sha" immediate-startup
      return 0
      ;;
    start-public-edge)
      commit_sha="${2:-}"
      [[ "$KEMERBET_V1_RETIREMENT_GATE_STATE" =~ ^(pending|resealed-awaiting-recheck)$ &&
        "$commit_sha" == "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" ]] ||
        die 'only the exact v1 retirement release may restart the public edge'
      require_kemerbet_v1_retirement_current_context "$commit_sha" ||
        die 'the v1 retirement context changed before public-edge recovery'
      kemerbet_v1_retirement_release_asset_digest "$commit_sha" >/dev/null ||
        die 'the same-release Compose or image identity changed before public-edge recovery'
      require_kemerbet_v1_retirement_expiry_guard_armed ||
        die 'the same-release expiry guard is not armed before public-edge recovery'
      require_exact_fresh_bot_runtime "$commit_sha" steady-state
      return 0
      ;;
    start-kemerbet-session-provision)
      commit_sha="${2:-}"
      [[ "$KEMERBET_V1_RETIREMENT_GATE_STATE" == 'pending' &&
        "$commit_sha" == "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" ]] ||
        die 'only the exact v1 retirement release may resume private sign-in'
      require_kemerbet_v1_retired_awaiting_v2 "$commit_sha" ||
        die 'private sign-in requires the exact retired-awaiting-v2 state'
      require_kemerbet_v1_retirement_expiry_guard_armed ||
        die 'the same-release expiry guard must be armed before private sign-in recovery'
      kemerbet_v1_retirement_release_asset_digest "$commit_sha" >/dev/null ||
        die 'the same-release assets changed before private sign-in recovery'
      require_exact_fresh_bot_runtime "$commit_sha" published-steady-state
      return 0
      ;;
    kemerbet-session-provision-ready)
      commit_sha="${2:-}"
      [[ "$KEMERBET_V1_RETIREMENT_GATE_STATE" == 'pending' &&
        "$commit_sha" == "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" ]] ||
        die 'only the exact v1 retirement release may attest recovered private sign-in'
      require_kemerbet_v1_retired_awaiting_v2 "$commit_sha" ||
        die 'private sign-in attestation requires the exact retired-awaiting-v2 state'
      require_kemerbet_v1_retirement_expiry_guard_armed ||
        die 'the same-release expiry guard is not armed for private sign-in attestation'
      kemerbet_v1_retirement_release_asset_digest "$commit_sha" >/dev/null ||
        die 'the same-release assets changed before private sign-in attestation'
      require_exact_fresh_bot_runtime "$commit_sha" published-with-kemerbet-session
      return 0
      ;;
    seal-kemerbet-readiness)
      commit_sha="${2:-}"
      [[ "$KEMERBET_V1_RETIREMENT_GATE_STATE" =~ \
          ^(pending|seal-finalization-prefix|resealed-awaiting-recheck)$ &&
        "$commit_sha" == "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" ]] ||
        die 'only the exact v1 retirement release may resume or attest v2 sealing'
      case "$KEMERBET_V1_RETIREMENT_GATE_STATE" in
        pending)
          require_kemerbet_v1_retirement_current_context "$commit_sha" &&
            require_kemerbet_v1_retirement_archive &&
            require_kemerbet_v1_retired_awaiting_v2 "$commit_sha" ||
            die 'v2 sealing requires the exact durable retired-awaiting-v2 state'
          ;;
        seal-finalization-prefix)
          if ! require_kemerbet_v1_retirement_seal_finalization_prefix "$commit_sha"; then
            require_kemerbet_v1_retirement_current_context "$commit_sha" &&
              require_kemerbet_v1_retirement_archive &&
              require_kemerbet_v1_retirement_completed_continuity &&
              [[ "$KEMERBET_V1_RETIREMENT_CONTINUITY_STATE" == \
                'resealed-awaiting-recheck' ]] ||
              die 'the v2 seal finalization prefix failed exact continuity attestation'
          fi
          ;;
        resealed-awaiting-recheck)
          require_kemerbet_v1_retirement_current_context "$commit_sha" &&
            require_kemerbet_v1_retirement_completed_continuity &&
            [[ "$KEMERBET_V1_RETIREMENT_CONTINUITY_STATE" == \
              'resealed-awaiting-recheck' ]] ||
            die 'the completed v2 seal failed exact continuity attestation'
          ;;
      esac
      return 0
      ;;
    recheck-kemerbet-readiness)
      commit_sha="${2:-}"
      [[ "$KEMERBET_V1_RETIREMENT_GATE_STATE" == 'resealed-awaiting-recheck' &&
        "$commit_sha" == "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" ]] ||
        die 'a v1 retirement transaction blocks readiness recheck until exact v2 completion'
      return 0
      ;;
    *)
      die 'a pending v1 retirement blocks helper replacement and unrelated staging mutations'
      ;;
  esac
}

KEMERBET_V2_V3_SUCCESSOR_GATE_STATE='absent'
KEMERBET_V2_V3_SUCCESSOR_RELEASE=''
KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256=''
KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE='absent'
KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE=''

inspect_kemerbet_v2_v3_successor_gate() {
  local inspection
  local parent="$KEMERBET_V2_V3_SUCCESSOR_PARENT"
  KEMERBET_V2_V3_SUCCESSOR_GATE_STATE='absent'
  KEMERBET_V2_V3_SUCCESSOR_RELEASE=''
  KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256=''
  KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE='absent'
  KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE=''
  if [[ ! -e "$parent" && ! -L "$parent" ]]; then
    return 0
  fi
  KEMERBET_V2_V3_SUCCESSOR_GATE_STATE='invalid'
  inspection="$(env -i PATH="$SAFE_PATH" python3 -I - \
    "$parent" "$HELPER_PATH" "$KEMERBET_READINESS_BINDING" \
    "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" "$KEMERBET_V1_RETIREMENT_ROOT" \
    "$KEMERBET_AGENT_IDENTITY_BINDINGS" "$KEMERBET_RECHECK_RECEIPT" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_COMPLETED_CLAIM_NAME" \
    "$KEMERBET_RECHECK_PROMOTION_ROOT" "$KEMERBET_READINESS_PLAYER_IDS" \
    "$KEMERBET_RECHECK_CANDIDATE_ROOT" "$KEMERBET_RECHECK_RPC_ROOT" \
    "$KEMERBET_SELECTOR_CONTRACT" "$KEMERBET_V3_HELPER_ROTATION_PARENT" \
    "$KEMERBET_V3_HELPER_ROTATION_V2_PARENT" \
    "$KEMERBET_V3_HELPER_ROTATION_V3_PARENT" \
    "$KEMERBET_V3_HELPER_ROTATION_V4_PARENT" \
    "$KEMERBET_V3_HELPER_ROTATION_V5_PARENT" \
    "$KEMERBET_V3_HELPER_ROTATION_V6_PARENT" \
    "$KEMERBET_V3_HELPER_ROTATION_V7_PARENT" \
    "$KEMERBET_V3_HELPER_ROTATION_V8_PARENT" \
    "$KEMERBET_V3_HELPER_ROTATION_V9_PARENT" \
    "$KEMERBET_V3_HELPER_ROTATION_V10_PARENT" \
    "$KEMERBET_V3_HELPER_ROTATION_V11_PARENT" <<'PY'
import hashlib
import os
import re
import stat
import sys

(
    parent,
    helper,
    binding,
    identity_key,
    retirement,
    committed_binding,
    recheck_receipt,
    owner_completion,
    promotion_root,
    readiness_player_ids,
    candidate_root,
    rpc_root,
    selector_contract,
    rotation_parent,
    rotation_v2_parent,
    rotation_v3_parent,
    rotation_v4_parent,
    rotation_v5_parent,
    rotation_v6_parent,
    rotation_v7_parent,
    rotation_v8_parent,
    rotation_v9_parent,
    rotation_v10_parent,
    rotation_v11_parent,
) = sys.argv[1:]
sha = re.compile(r'[0-9a-f]{64}')
release = re.compile(r'[0-9a-f]{40}')
compose_version = re.compile(r'[0-9]+\.[0-9]+\.[0-9]+(?:[+~-][0-9A-Za-z._-]+)?')
claim = re.compile(rb'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\n')
uuid = rb'[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
v2 = re.compile(
    b'(' + uuid + rb') hmac-sha256-agent-identity-v1:([0-9a-f]{64}) '
    rb'sha256-provider-authorization-v1:[0-9a-f]{64}\n'
)
v3 = re.compile(
    b'(' + uuid + rb') hmac-sha256-agent-identity-v1:([0-9a-f]{64}) '
    rb'hmac-sha256-agent-profile-pin-v3:\2\n'
)


def reject():
    raise RuntimeError()


def exact_directory(path, mode, entries):
    value = os.lstat(path)
    if (
        not stat.S_ISDIR(value.st_mode)
        or (value.st_uid, value.st_gid) != (0, 0)
        or stat.S_IMODE(value.st_mode) != mode
        or os.path.realpath(path) != path
        or sorted(os.listdir(path)) != entries
    ):
        reject()


def exact_file(path, owner, mode, maximum, exact_size=None):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        named = os.lstat(path)
        if (
            not stat.S_ISREG(before.st_mode)
            or (before.st_uid, before.st_gid) != owner
            or stat.S_IMODE(before.st_mode) != mode
            or before.st_nlink != 1
            or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
            or before.st_size > maximum
            or (exact_size is not None and before.st_size != exact_size)
            or os.path.realpath(path) != path
        ):
            reject()
        data = bytearray()
        while len(data) <= maximum:
            chunk = os.read(descriptor, maximum + 1 - len(data))
            if not chunk:
                break
            data.extend(chunk)
        after = os.fstat(descriptor)
        named_after = os.lstat(path)
        if (
            (before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid,
             before.st_nlink, before.st_size, before.st_mtime_ns) !=
            (after.st_dev, after.st_ino, after.st_mode, after.st_uid, after.st_gid,
             after.st_nlink, after.st_size, after.st_mtime_ns)
            or (after.st_dev, after.st_ino) != (named_after.st_dev, named_after.st_ino)
        ):
            reject()
        return bytes(data)
    finally:
        os.close(descriptor)


value = os.lstat(parent)
if (
    not stat.S_ISDIR(value.st_mode)
    or (value.st_uid, value.st_gid) != (0, 0)
    or stat.S_IMODE(value.st_mode) != 0o700
    or os.path.realpath(parent) != parent
):
    reject()

children = sorted(os.listdir(parent))
if len(children) != 1 or release.fullmatch(children[0]) is None:
    reject()
successor = children[0]
root = f'{parent}/{successor}'
base_entries = ['binding-v2', 'completed-v1', 'intent-v1', 'predecessor-helper']
exact_directory(root, 0o700, base_entries)

intent_data = exact_file(f'{root}/intent-v1', (0, 0), 0o600, 4096)
completion_data = exact_file(f'{root}/completed-v1', (0, 0), 0o600, 4096)
intent = intent_data.decode('ascii').splitlines()
completion = completion_data.decode('ascii').splitlines()
if (
    len(intent) != 9
    or len(completion) != 10
    or intent[0] != 'contract=fetanagent-kemerbet-readiness-v2-v3-successor-v1'
    or intent[1] != 'state=authorized'
    or not intent[2].startswith('predecessor_release=')
    or release.fullmatch(intent[2].split('=', 1)[1]) is None
    or intent[3] != f'successor_release={successor}'
    or not intent[4].startswith('predecessor_helper_sha256=')
    or sha.fullmatch(intent[4].split('=', 1)[1]) is None
    or not intent[5].startswith('successor_helper_sha256=')
    or sha.fullmatch(intent[5].split('=', 1)[1]) is None
    or not intent[6].startswith('v2_binding_sha256=')
    or sha.fullmatch(intent[6].split('=', 1)[1]) is None
    or not intent[7].startswith('retirement_intent_sha256=')
    or sha.fullmatch(intent[7].split('=', 1)[1]) is None
    or not intent[8].startswith('retirement_completion_sha256=')
    or sha.fullmatch(intent[8].split('=', 1)[1]) is None
    or intent[2].split('=', 1)[1] == successor
    or completion[:1] != intent[:1]
    or completion[1] != 'state=successor-installed'
    or completion[2:9] != intent[2:9]
    or not completion[9].startswith('v3_binding_sha256=')
    or sha.fullmatch(completion[9].split('=', 1)[1]) is None
    or intent_data != ('\n'.join(intent) + '\n').encode('ascii')
    or completion_data != ('\n'.join(completion) + '\n').encode('ascii')
):
    reject()

predecessor = intent[2].split('=', 1)[1]
predecessor_helper_sha = intent[4].split('=', 1)[1]
successor_helper_sha = intent[5].split('=', 1)[1]
v2_sha = intent[6].split('=', 1)[1]
retirement_intent_sha = intent[7].split('=', 1)[1]
retirement_completion_sha = intent[8].split('=', 1)[1]
v3_sha = completion[9].split('=', 1)[1]

old_helper_data = exact_file(f'{root}/predecessor-helper', (0, 0), 0o400, 2 * 1024 * 1024)
v2_data = exact_file(f'{root}/binding-v2', (0, 0), 0o400, 230, 230)
v2_match = v2.fullmatch(v2_data)
if (
    hashlib.sha256(old_helper_data).hexdigest() != predecessor_helper_sha
    or hashlib.sha256(v2_data).hexdigest() != v2_sha
    or v2_match is None
):
    reject()

effective_release = successor
effective_helper_sha = successor_helper_sha
rotation_intent_data = None
rotation_completion_data = None
archived_successor_helper = None
if os.path.lexists(rotation_parent):
    rotation_parent_value = os.lstat(rotation_parent)
    if (
        not stat.S_ISDIR(rotation_parent_value.st_mode)
        or (rotation_parent_value.st_uid, rotation_parent_value.st_gid,
            stat.S_IMODE(rotation_parent_value.st_mode)) != (0, 0, 0o700)
        or os.path.realpath(rotation_parent) != rotation_parent
    ):
        reject()
    rotation_children = os.listdir(rotation_parent)
    if len(rotation_children) != 1 or release.fullmatch(rotation_children[0]) is None:
        reject()
    rotation_release = rotation_children[0]
    rotation_root = f'{rotation_parent}/{rotation_release}'
    exact_directory(rotation_parent, 0o700, [rotation_release])
    exact_directory(
        rotation_root,
        0o700,
        ['completed-v1', 'intent-v1', 'predecessor-helper'],
    )
    rotation_intent_data = exact_file(
        f'{rotation_root}/intent-v1',
        (0, 0),
        0o600,
        4096,
    )
    rotation_completion_data = exact_file(
        f'{rotation_root}/completed-v1',
        (0, 0),
        0o600,
        4096,
    )
    rotation_intent = rotation_intent_data.decode('ascii').splitlines()
    rotation_completion = rotation_completion_data.decode('ascii').splitlines()
    if (
        len(rotation_intent) != 15
        or len(rotation_completion) != 16
        or rotation_intent[0] != 'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v1'
        or rotation_intent[1] != 'state=authorized'
        or rotation_intent[2] != f'predecessor_release={successor}'
        or rotation_intent[3] != f'successor_release={rotation_release}'
        or rotation_release == successor
        or rotation_intent[4] != f'predecessor_helper_sha256={successor_helper_sha}'
        or not rotation_intent[5].startswith('successor_helper_sha256=')
        or sha.fullmatch(rotation_intent[5].split('=', 1)[1]) is None
        or rotation_intent[5].split('=', 1)[1] == successor_helper_sha
        or rotation_intent[6] !=
           f'base_successor_intent_sha256={hashlib.sha256(intent_data).hexdigest()}'
        or rotation_intent[7] !=
           f'base_successor_completion_sha256={hashlib.sha256(completion_data).hexdigest()}'
        or rotation_intent[8] != f'base_binding_v2_sha256={v2_sha}'
        or rotation_intent[9] !=
           f'base_predecessor_helper_sha256={hashlib.sha256(old_helper_data).hexdigest()}'
        or rotation_intent[10] != f'base_binding_v3_sha256={v3_sha}'
        or not rotation_intent[11].startswith('compose5_durable_volume_digest=')
        or sha.fullmatch(rotation_intent[11].split('=', 1)[1]) is None
        or not rotation_intent[12].startswith('compose5_profile_config_hash=')
        or sha.fullmatch(rotation_intent[12].split('=', 1)[1]) is None
        or not rotation_intent[13].startswith('compose5_session_control_config_hash=')
        or sha.fullmatch(rotation_intent[13].split('=', 1)[1]) is None
        or not rotation_intent[14].startswith('compose5_volume_version=')
        or compose_version.fullmatch(rotation_intent[14].split('=', 1)[1]) is None
        or rotation_completion[:1] != rotation_intent[:1]
        or rotation_completion[1] != 'state=successor-installed'
        or rotation_completion[2:15] != rotation_intent[2:15]
        or rotation_completion[15] !=
           f'rotation_intent_sha256={hashlib.sha256(rotation_intent_data).hexdigest()}'
        or rotation_intent_data != ('\n'.join(rotation_intent) + '\n').encode('ascii')
        or rotation_completion_data != ('\n'.join(rotation_completion) + '\n').encode('ascii')
    ):
        reject()
    archived_successor_helper = exact_file(
        f'{rotation_root}/predecessor-helper',
        (0, 0),
        0o400,
        2 * 1024 * 1024,
    )
    if hashlib.sha256(archived_successor_helper).hexdigest() != successor_helper_sha:
        reject()
    effective_release = rotation_release
    effective_helper_sha = rotation_intent[5].split('=', 1)[1]

rotation_v2_intent_data = None
rotation_v2_completion_data = None
archived_rotation_v2_predecessor_helper = None
if os.path.lexists(rotation_v2_parent):
    if (
        rotation_intent_data is None
        or rotation_completion_data is None
        or archived_successor_helper is None
    ):
        reject()
    rotation_v2_parent_value = os.lstat(rotation_v2_parent)
    if (
        not stat.S_ISDIR(rotation_v2_parent_value.st_mode)
        or (rotation_v2_parent_value.st_uid, rotation_v2_parent_value.st_gid,
            stat.S_IMODE(rotation_v2_parent_value.st_mode)) != (0, 0, 0o700)
        or os.path.realpath(rotation_v2_parent) != rotation_v2_parent
    ):
        reject()
    rotation_v2_children = os.listdir(rotation_v2_parent)
    if len(rotation_v2_children) != 1 or release.fullmatch(rotation_v2_children[0]) is None:
        reject()
    rotation_v2_release = rotation_v2_children[0]
    rotation_v2_root = f'{rotation_v2_parent}/{rotation_v2_release}'
    exact_directory(rotation_v2_parent, 0o700, [rotation_v2_release])
    exact_directory(
        rotation_v2_root,
        0o700,
        ['completed-v1', 'intent-v1', 'predecessor-helper'],
    )
    rotation_v2_intent_data = exact_file(
        f'{rotation_v2_root}/intent-v1',
        (0, 0),
        0o600,
        4096,
    )
    rotation_v2_completion_data = exact_file(
        f'{rotation_v2_root}/completed-v1',
        (0, 0),
        0o600,
        4096,
    )
    rotation_v2_intent = rotation_v2_intent_data.decode('ascii').splitlines()
    rotation_v2_completion = rotation_v2_completion_data.decode('ascii').splitlines()
    if (
        len(rotation_v2_intent) != 18
        or len(rotation_v2_completion) != 19
        or rotation_v2_intent[0] !=
           'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v2'
        or rotation_v2_intent[1] != 'state=authorized'
        or rotation_v2_intent[2] != f'predecessor_release={effective_release}'
        or rotation_v2_intent[3] != f'successor_release={rotation_v2_release}'
        or rotation_v2_release == effective_release
        or rotation_v2_intent[4] !=
           f'predecessor_helper_sha256={effective_helper_sha}'
        or not rotation_v2_intent[5].startswith('successor_helper_sha256=')
        or sha.fullmatch(rotation_v2_intent[5].split('=', 1)[1]) is None
        or rotation_v2_intent[5].split('=', 1)[1] == effective_helper_sha
        or rotation_v2_intent[6] !=
           f'base_successor_intent_sha256={hashlib.sha256(intent_data).hexdigest()}'
        or rotation_v2_intent[7] !=
           f'base_successor_completion_sha256={hashlib.sha256(completion_data).hexdigest()}'
        or rotation_v2_intent[8] != f'base_binding_v2_sha256={v2_sha}'
        or rotation_v2_intent[9] !=
           f'base_predecessor_helper_sha256={hashlib.sha256(old_helper_data).hexdigest()}'
        or rotation_v2_intent[10] != f'base_binding_v3_sha256={v3_sha}'
        or rotation_v2_intent[11] !=
           f'predecessor_rotation_intent_sha256={hashlib.sha256(rotation_intent_data).hexdigest()}'
        or rotation_v2_intent[12] !=
           f'predecessor_rotation_completion_sha256={hashlib.sha256(rotation_completion_data).hexdigest()}'
        or rotation_v2_intent[13] !=
           f'predecessor_rotation_helper_archive_sha256={hashlib.sha256(archived_successor_helper).hexdigest()}'
        or rotation_v2_intent[14] != rotation_intent[11]
        or rotation_v2_intent[15] != rotation_intent[12]
        or rotation_v2_intent[16] != rotation_intent[13]
        or rotation_v2_intent[17] != rotation_intent[14]
        or not rotation_v2_intent[14].startswith('compose5_durable_volume_digest=')
        or sha.fullmatch(rotation_v2_intent[14].split('=', 1)[1]) is None
        or not rotation_v2_intent[15].startswith('compose5_profile_config_hash=')
        or sha.fullmatch(rotation_v2_intent[15].split('=', 1)[1]) is None
        or not rotation_v2_intent[16].startswith('compose5_session_control_config_hash=')
        or sha.fullmatch(rotation_v2_intent[16].split('=', 1)[1]) is None
        or not rotation_v2_intent[17].startswith('compose5_volume_version=')
        or compose_version.fullmatch(rotation_v2_intent[17].split('=', 1)[1]) is None
        or rotation_v2_completion[:1] != rotation_v2_intent[:1]
        or rotation_v2_completion[1] != 'state=successor-installed'
        or rotation_v2_completion[2:18] != rotation_v2_intent[2:18]
        or rotation_v2_completion[18] !=
           f'rotation_intent_sha256={hashlib.sha256(rotation_v2_intent_data).hexdigest()}'
        or rotation_v2_intent_data !=
           ('\n'.join(rotation_v2_intent) + '\n').encode('ascii')
        or rotation_v2_completion_data !=
           ('\n'.join(rotation_v2_completion) + '\n').encode('ascii')
    ):
        reject()
    archived_rotation_v2_predecessor_helper = exact_file(
        f'{rotation_v2_root}/predecessor-helper',
        (0, 0),
        0o400,
        2 * 1024 * 1024,
    )
    if hashlib.sha256(archived_rotation_v2_predecessor_helper).hexdigest() != effective_helper_sha:
        reject()
    effective_release = rotation_v2_release
    effective_helper_sha = rotation_v2_intent[5].split('=', 1)[1]

rotation_v3_intent_data = None
rotation_v3_completion_data = None
archived_rotation_v3_predecessor_helper = None
if os.path.lexists(rotation_v3_parent):
    if (
        rotation_v2_intent_data is None
        or rotation_v2_completion_data is None
        or archived_rotation_v2_predecessor_helper is None
    ):
        reject()
    rotation_v3_parent_value = os.lstat(rotation_v3_parent)
    if (
        not stat.S_ISDIR(rotation_v3_parent_value.st_mode)
        or (rotation_v3_parent_value.st_uid, rotation_v3_parent_value.st_gid,
            stat.S_IMODE(rotation_v3_parent_value.st_mode)) != (0, 0, 0o700)
        or os.path.realpath(rotation_v3_parent) != rotation_v3_parent
    ):
        reject()
    rotation_v3_children = os.listdir(rotation_v3_parent)
    if len(rotation_v3_children) != 1 or release.fullmatch(rotation_v3_children[0]) is None:
        reject()
    rotation_v3_release = rotation_v3_children[0]
    rotation_v3_root = f'{rotation_v3_parent}/{rotation_v3_release}'
    exact_directory(rotation_v3_parent, 0o700, [rotation_v3_release])
    exact_directory(
        rotation_v3_root,
        0o700,
        ['completed-v1', 'intent-v1', 'predecessor-helper'],
    )
    rotation_v3_intent_data = exact_file(
        f'{rotation_v3_root}/intent-v1',
        (0, 0),
        0o600,
        4096,
    )
    rotation_v3_completion_data = exact_file(
        f'{rotation_v3_root}/completed-v1',
        (0, 0),
        0o600,
        4096,
    )
    rotation_v3_intent = rotation_v3_intent_data.decode('ascii').splitlines()
    rotation_v3_completion = rotation_v3_completion_data.decode('ascii').splitlines()
    if (
        len(rotation_v3_intent) != 18
        or len(rotation_v3_completion) != 19
        or rotation_v3_intent[0] !=
           'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v3'
        or rotation_v3_intent[1] != 'state=authorized'
        or rotation_v3_intent[2] != f'predecessor_release={effective_release}'
        or rotation_v3_intent[3] != f'successor_release={rotation_v3_release}'
        or rotation_v3_release in {successor, rotation_release, effective_release}
        or rotation_v3_intent[4] !=
           f'predecessor_helper_sha256={effective_helper_sha}'
        or not rotation_v3_intent[5].startswith('successor_helper_sha256=')
        or sha.fullmatch(rotation_v3_intent[5].split('=', 1)[1]) is None
        or rotation_v3_intent[5].split('=', 1)[1] in {
            successor_helper_sha,
            rotation_intent[5].split('=', 1)[1],
            effective_helper_sha,
        }
        or rotation_v3_intent[6] !=
           f'base_successor_intent_sha256={hashlib.sha256(intent_data).hexdigest()}'
        or rotation_v3_intent[7] !=
           f'base_successor_completion_sha256={hashlib.sha256(completion_data).hexdigest()}'
        or rotation_v3_intent[8] != f'base_binding_v2_sha256={v2_sha}'
        or rotation_v3_intent[9] !=
           f'base_predecessor_helper_sha256={hashlib.sha256(old_helper_data).hexdigest()}'
        or rotation_v3_intent[10] != f'base_binding_v3_sha256={v3_sha}'
        or rotation_v3_intent[11] !=
           f'predecessor_rotation_intent_sha256={hashlib.sha256(rotation_v2_intent_data).hexdigest()}'
        or rotation_v3_intent[12] !=
           f'predecessor_rotation_completion_sha256={hashlib.sha256(rotation_v2_completion_data).hexdigest()}'
        or rotation_v3_intent[13] !=
           f'predecessor_rotation_helper_archive_sha256={hashlib.sha256(archived_rotation_v2_predecessor_helper).hexdigest()}'
        or rotation_v3_intent[14] != rotation_v2_intent[14]
        or rotation_v3_intent[15] != rotation_v2_intent[15]
        or rotation_v3_intent[16] != rotation_v2_intent[16]
        or rotation_v3_intent[17] != rotation_v2_intent[17]
        or not rotation_v3_intent[14].startswith('compose5_durable_volume_digest=')
        or sha.fullmatch(rotation_v3_intent[14].split('=', 1)[1]) is None
        or not rotation_v3_intent[15].startswith('compose5_profile_config_hash=')
        or sha.fullmatch(rotation_v3_intent[15].split('=', 1)[1]) is None
        or not rotation_v3_intent[16].startswith('compose5_session_control_config_hash=')
        or sha.fullmatch(rotation_v3_intent[16].split('=', 1)[1]) is None
        or not rotation_v3_intent[17].startswith('compose5_volume_version=')
        or compose_version.fullmatch(rotation_v3_intent[17].split('=', 1)[1]) is None
        or rotation_v3_completion[:1] != rotation_v3_intent[:1]
        or rotation_v3_completion[1] != 'state=successor-installed'
        or rotation_v3_completion[2:18] != rotation_v3_intent[2:18]
        or rotation_v3_completion[18] !=
           f'rotation_intent_sha256={hashlib.sha256(rotation_v3_intent_data).hexdigest()}'
        or rotation_v3_intent_data !=
           ('\n'.join(rotation_v3_intent) + '\n').encode('ascii')
        or rotation_v3_completion_data !=
           ('\n'.join(rotation_v3_completion) + '\n').encode('ascii')
    ):
        reject()
    archived_rotation_v3_predecessor_helper = exact_file(
        f'{rotation_v3_root}/predecessor-helper',
        (0, 0),
        0o400,
        2 * 1024 * 1024,
    )
    if hashlib.sha256(archived_rotation_v3_predecessor_helper).hexdigest() != effective_helper_sha:
        reject()
    effective_release = rotation_v3_release
    effective_helper_sha = rotation_v3_intent[5].split('=', 1)[1]

rotation_v4_intent_data = None
rotation_v4_completion_data = None
archived_rotation_v4_predecessor_helper = None
if os.path.lexists(rotation_v4_parent):
    if (
        rotation_v3_intent_data is None
        or rotation_v3_completion_data is None
        or archived_rotation_v3_predecessor_helper is None
    ):
        reject()
    rotation_v4_parent_value = os.lstat(rotation_v4_parent)
    if (
        not stat.S_ISDIR(rotation_v4_parent_value.st_mode)
        or (rotation_v4_parent_value.st_uid, rotation_v4_parent_value.st_gid,
            stat.S_IMODE(rotation_v4_parent_value.st_mode)) != (0, 0, 0o700)
        or os.path.realpath(rotation_v4_parent) != rotation_v4_parent
    ):
        reject()
    rotation_v4_children = os.listdir(rotation_v4_parent)
    if len(rotation_v4_children) != 1 or release.fullmatch(rotation_v4_children[0]) is None:
        reject()
    rotation_v4_release = rotation_v4_children[0]
    rotation_v4_root = f'{rotation_v4_parent}/{rotation_v4_release}'
    exact_directory(rotation_v4_parent, 0o700, [rotation_v4_release])
    exact_directory(
        rotation_v4_root,
        0o700,
        ['completed-v1', 'intent-v1', 'predecessor-helper'],
    )
    rotation_v4_intent_data = exact_file(
        f'{rotation_v4_root}/intent-v1',
        (0, 0),
        0o600,
        4096,
    )
    rotation_v4_completion_data = exact_file(
        f'{rotation_v4_root}/completed-v1',
        (0, 0),
        0o600,
        4096,
    )
    rotation_v4_intent = rotation_v4_intent_data.decode('ascii').splitlines()
    rotation_v4_completion = rotation_v4_completion_data.decode('ascii').splitlines()
    if (
        len(rotation_v4_intent) != 18
        or len(rotation_v4_completion) != 19
        or rotation_v4_intent[0] !=
           'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v4'
        or rotation_v4_intent[1] != 'state=authorized'
        or rotation_v4_intent[2] != f'predecessor_release={effective_release}'
        or rotation_v4_intent[3] != f'successor_release={rotation_v4_release}'
        or rotation_v4_release in {
            successor,
            rotation_release,
            rotation_v2_release,
            effective_release,
        }
        or rotation_v4_intent[4] !=
           f'predecessor_helper_sha256={effective_helper_sha}'
        or not rotation_v4_intent[5].startswith('successor_helper_sha256=')
        or sha.fullmatch(rotation_v4_intent[5].split('=', 1)[1]) is None
        or rotation_v4_intent[5].split('=', 1)[1] in {
            successor_helper_sha,
            rotation_intent[5].split('=', 1)[1],
            rotation_v2_intent[5].split('=', 1)[1],
            effective_helper_sha,
        }
        or rotation_v4_intent[6] !=
           f'base_successor_intent_sha256={hashlib.sha256(intent_data).hexdigest()}'
        or rotation_v4_intent[7] !=
           f'base_successor_completion_sha256={hashlib.sha256(completion_data).hexdigest()}'
        or rotation_v4_intent[8] != f'base_binding_v2_sha256={v2_sha}'
        or rotation_v4_intent[9] !=
           f'base_predecessor_helper_sha256={hashlib.sha256(old_helper_data).hexdigest()}'
        or rotation_v4_intent[10] != f'base_binding_v3_sha256={v3_sha}'
        or rotation_v4_intent[11] !=
           f'predecessor_rotation_intent_sha256={hashlib.sha256(rotation_v3_intent_data).hexdigest()}'
        or rotation_v4_intent[12] !=
           f'predecessor_rotation_completion_sha256={hashlib.sha256(rotation_v3_completion_data).hexdigest()}'
        or rotation_v4_intent[13] !=
           f'predecessor_rotation_helper_archive_sha256={hashlib.sha256(archived_rotation_v3_predecessor_helper).hexdigest()}'
        or rotation_v4_intent[14] != rotation_v3_intent[14]
        or rotation_v4_intent[15] != rotation_v3_intent[15]
        or rotation_v4_intent[16] != rotation_v3_intent[16]
        or rotation_v4_intent[17] != rotation_v3_intent[17]
        or not rotation_v4_intent[14].startswith('compose5_durable_volume_digest=')
        or sha.fullmatch(rotation_v4_intent[14].split('=', 1)[1]) is None
        or not rotation_v4_intent[15].startswith('compose5_profile_config_hash=')
        or sha.fullmatch(rotation_v4_intent[15].split('=', 1)[1]) is None
        or not rotation_v4_intent[16].startswith('compose5_session_control_config_hash=')
        or sha.fullmatch(rotation_v4_intent[16].split('=', 1)[1]) is None
        or not rotation_v4_intent[17].startswith('compose5_volume_version=')
        or compose_version.fullmatch(rotation_v4_intent[17].split('=', 1)[1]) is None
        or rotation_v4_completion[:1] != rotation_v4_intent[:1]
        or rotation_v4_completion[1] != 'state=successor-installed'
        or rotation_v4_completion[2:18] != rotation_v4_intent[2:18]
        or rotation_v4_completion[18] !=
           f'rotation_intent_sha256={hashlib.sha256(rotation_v4_intent_data).hexdigest()}'
        or rotation_v4_intent_data !=
           ('\n'.join(rotation_v4_intent) + '\n').encode('ascii')
        or rotation_v4_completion_data !=
           ('\n'.join(rotation_v4_completion) + '\n').encode('ascii')
    ):
        reject()
    archived_rotation_v4_predecessor_helper = exact_file(
        f'{rotation_v4_root}/predecessor-helper',
        (0, 0),
        0o400,
        2 * 1024 * 1024,
    )
    if hashlib.sha256(archived_rotation_v4_predecessor_helper).hexdigest() != effective_helper_sha:
        reject()
    effective_release = rotation_v4_release
    effective_helper_sha = rotation_v4_intent[5].split('=', 1)[1]

rotation_v5_intent_data = None
rotation_v5_completion_data = None
archived_rotation_v5_predecessor_helper = None
if os.path.lexists(rotation_v5_parent):
    if (
        rotation_v4_intent_data is None
        or rotation_v4_completion_data is None
        or archived_rotation_v4_predecessor_helper is None
    ):
        reject()
    rotation_v5_parent_value = os.lstat(rotation_v5_parent)
    if (
        not stat.S_ISDIR(rotation_v5_parent_value.st_mode)
        or (rotation_v5_parent_value.st_uid, rotation_v5_parent_value.st_gid,
            stat.S_IMODE(rotation_v5_parent_value.st_mode)) != (0, 0, 0o700)
        or os.path.realpath(rotation_v5_parent) != rotation_v5_parent
    ):
        reject()
    rotation_v5_children = os.listdir(rotation_v5_parent)
    if len(rotation_v5_children) != 1 or release.fullmatch(rotation_v5_children[0]) is None:
        reject()
    rotation_v5_release = rotation_v5_children[0]
    rotation_v5_root = f'{rotation_v5_parent}/{rotation_v5_release}'
    exact_directory(rotation_v5_parent, 0o700, [rotation_v5_release])
    exact_directory(
        rotation_v5_root,
        0o700,
        ['completed-v1', 'intent-v1', 'predecessor-helper'],
    )
    rotation_v5_intent_data = exact_file(
        f'{rotation_v5_root}/intent-v1',
        (0, 0),
        0o600,
        4096,
    )
    rotation_v5_completion_data = exact_file(
        f'{rotation_v5_root}/completed-v1',
        (0, 0),
        0o600,
        4096,
    )
    rotation_v5_intent = rotation_v5_intent_data.decode('ascii').splitlines()
    rotation_v5_completion = rotation_v5_completion_data.decode('ascii').splitlines()
    if (
        len(rotation_v5_intent) != 18
        or len(rotation_v5_completion) != 19
        or rotation_v5_intent[0] !=
           'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v5'
        or rotation_v5_intent[1] != 'state=authorized'
        or rotation_v5_intent[2] != f'predecessor_release={effective_release}'
        or rotation_v5_intent[3] != f'successor_release={rotation_v5_release}'
        or rotation_v5_release in {
            successor,
            rotation_release,
            rotation_v2_release,
            rotation_v3_release,
            effective_release,
        }
        or rotation_v5_intent[4] !=
           f'predecessor_helper_sha256={effective_helper_sha}'
        or not rotation_v5_intent[5].startswith('successor_helper_sha256=')
        or sha.fullmatch(rotation_v5_intent[5].split('=', 1)[1]) is None
        or rotation_v5_intent[5].split('=', 1)[1] in {
            successor_helper_sha,
            rotation_intent[5].split('=', 1)[1],
            rotation_v2_intent[5].split('=', 1)[1],
            rotation_v3_intent[5].split('=', 1)[1],
            effective_helper_sha,
        }
        or rotation_v5_intent[6] !=
           f'base_successor_intent_sha256={hashlib.sha256(intent_data).hexdigest()}'
        or rotation_v5_intent[7] !=
           f'base_successor_completion_sha256={hashlib.sha256(completion_data).hexdigest()}'
        or rotation_v5_intent[8] != f'base_binding_v2_sha256={v2_sha}'
        or rotation_v5_intent[9] !=
           f'base_predecessor_helper_sha256={hashlib.sha256(old_helper_data).hexdigest()}'
        or rotation_v5_intent[10] != f'base_binding_v3_sha256={v3_sha}'
        or rotation_v5_intent[11] !=
           f'predecessor_rotation_intent_sha256={hashlib.sha256(rotation_v4_intent_data).hexdigest()}'
        or rotation_v5_intent[12] !=
           f'predecessor_rotation_completion_sha256={hashlib.sha256(rotation_v4_completion_data).hexdigest()}'
        or rotation_v5_intent[13] !=
           f'predecessor_rotation_helper_archive_sha256={hashlib.sha256(archived_rotation_v4_predecessor_helper).hexdigest()}'
        or rotation_v5_intent[14] != rotation_v4_intent[14]
        or rotation_v5_intent[15] != rotation_v4_intent[15]
        or rotation_v5_intent[16] != rotation_v4_intent[16]
        or rotation_v5_intent[17] != rotation_v4_intent[17]
        or not rotation_v5_intent[14].startswith('compose5_durable_volume_digest=')
        or sha.fullmatch(rotation_v5_intent[14].split('=', 1)[1]) is None
        or not rotation_v5_intent[15].startswith('compose5_profile_config_hash=')
        or sha.fullmatch(rotation_v5_intent[15].split('=', 1)[1]) is None
        or not rotation_v5_intent[16].startswith('compose5_session_control_config_hash=')
        or sha.fullmatch(rotation_v5_intent[16].split('=', 1)[1]) is None
        or not rotation_v5_intent[17].startswith('compose5_volume_version=')
        or compose_version.fullmatch(rotation_v5_intent[17].split('=', 1)[1]) is None
        or rotation_v5_completion[:1] != rotation_v5_intent[:1]
        or rotation_v5_completion[1] != 'state=successor-installed'
        or rotation_v5_completion[2:18] != rotation_v5_intent[2:18]
        or rotation_v5_completion[18] !=
           f'rotation_intent_sha256={hashlib.sha256(rotation_v5_intent_data).hexdigest()}'
        or rotation_v5_intent_data !=
           ('\n'.join(rotation_v5_intent) + '\n').encode('ascii')
        or rotation_v5_completion_data !=
           ('\n'.join(rotation_v5_completion) + '\n').encode('ascii')
    ):
        reject()
    archived_rotation_v5_predecessor_helper = exact_file(
        f'{rotation_v5_root}/predecessor-helper',
        (0, 0),
        0o400,
        2 * 1024 * 1024,
    )
    if hashlib.sha256(archived_rotation_v5_predecessor_helper).hexdigest() != effective_helper_sha:
        reject()
    effective_release = rotation_v5_release
    effective_helper_sha = rotation_v5_intent[5].split('=', 1)[1]

rotation_v6_intent_data = None
rotation_v6_completion_data = None
archived_rotation_v6_predecessor_helper = None
if os.path.lexists(rotation_v6_parent):
    if (
        rotation_v5_intent_data is None
        or rotation_v5_completion_data is None
        or archived_rotation_v5_predecessor_helper is None
    ):
        reject()
    rotation_v6_parent_value = os.lstat(rotation_v6_parent)
    if (
        not stat.S_ISDIR(rotation_v6_parent_value.st_mode)
        or (rotation_v6_parent_value.st_uid, rotation_v6_parent_value.st_gid,
            stat.S_IMODE(rotation_v6_parent_value.st_mode)) != (0, 0, 0o700)
        or os.path.realpath(rotation_v6_parent) != rotation_v6_parent
    ):
        reject()
    rotation_v6_children = os.listdir(rotation_v6_parent)
    if len(rotation_v6_children) != 1 or release.fullmatch(rotation_v6_children[0]) is None:
        reject()
    rotation_v6_release = rotation_v6_children[0]
    rotation_v6_root = f'{rotation_v6_parent}/{rotation_v6_release}'
    exact_directory(rotation_v6_parent, 0o700, [rotation_v6_release])
    exact_directory(
        rotation_v6_root,
        0o700,
        ['completed-v1', 'intent-v1', 'predecessor-helper'],
    )
    rotation_v6_intent_data = exact_file(
        f'{rotation_v6_root}/intent-v1',
        (0, 0),
        0o600,
        4096,
    )
    rotation_v6_completion_data = exact_file(
        f'{rotation_v6_root}/completed-v1',
        (0, 0),
        0o600,
        4096,
    )
    rotation_v6_intent = rotation_v6_intent_data.decode('ascii').splitlines()
    rotation_v6_completion = rotation_v6_completion_data.decode('ascii').splitlines()
    if (
        len(rotation_v6_intent) != 18
        or len(rotation_v6_completion) != 19
        or rotation_v6_intent[0] !=
           'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v6'
        or rotation_v6_intent[1] != 'state=authorized'
        or rotation_v6_intent[2] != f'predecessor_release={effective_release}'
        or rotation_v6_intent[3] != f'successor_release={rotation_v6_release}'
        or rotation_v6_release in {
            successor,
            rotation_release,
            rotation_v2_release,
            rotation_v3_release,
            rotation_v4_release,
            effective_release,
        }
        or rotation_v6_intent[4] !=
           f'predecessor_helper_sha256={effective_helper_sha}'
        or not rotation_v6_intent[5].startswith('successor_helper_sha256=')
        or sha.fullmatch(rotation_v6_intent[5].split('=', 1)[1]) is None
        or rotation_v6_intent[5].split('=', 1)[1] in {
            successor_helper_sha,
            rotation_intent[5].split('=', 1)[1],
            rotation_v2_intent[5].split('=', 1)[1],
            rotation_v3_intent[5].split('=', 1)[1],
            rotation_v4_intent[5].split('=', 1)[1],
            effective_helper_sha,
        }
        or rotation_v6_intent[6] !=
           f'base_successor_intent_sha256={hashlib.sha256(intent_data).hexdigest()}'
        or rotation_v6_intent[7] !=
           f'base_successor_completion_sha256={hashlib.sha256(completion_data).hexdigest()}'
        or rotation_v6_intent[8] != f'base_binding_v2_sha256={v2_sha}'
        or rotation_v6_intent[9] !=
           f'base_predecessor_helper_sha256={hashlib.sha256(old_helper_data).hexdigest()}'
        or rotation_v6_intent[10] != f'base_binding_v3_sha256={v3_sha}'
        or rotation_v6_intent[11] !=
           f'predecessor_rotation_intent_sha256={hashlib.sha256(rotation_v5_intent_data).hexdigest()}'
        or rotation_v6_intent[12] !=
           f'predecessor_rotation_completion_sha256={hashlib.sha256(rotation_v5_completion_data).hexdigest()}'
        or rotation_v6_intent[13] !=
           f'predecessor_rotation_helper_archive_sha256={hashlib.sha256(archived_rotation_v5_predecessor_helper).hexdigest()}'
        or rotation_v6_intent[14] != rotation_v5_intent[14]
        or rotation_v6_intent[15] != rotation_v5_intent[15]
        or rotation_v6_intent[16] != rotation_v5_intent[16]
        or rotation_v6_intent[17] != rotation_v5_intent[17]
        or not rotation_v6_intent[14].startswith('compose5_durable_volume_digest=')
        or sha.fullmatch(rotation_v6_intent[14].split('=', 1)[1]) is None
        or not rotation_v6_intent[15].startswith('compose5_profile_config_hash=')
        or sha.fullmatch(rotation_v6_intent[15].split('=', 1)[1]) is None
        or not rotation_v6_intent[16].startswith('compose5_session_control_config_hash=')
        or sha.fullmatch(rotation_v6_intent[16].split('=', 1)[1]) is None
        or not rotation_v6_intent[17].startswith('compose5_volume_version=')
        or compose_version.fullmatch(rotation_v6_intent[17].split('=', 1)[1]) is None
        or rotation_v6_completion[:1] != rotation_v6_intent[:1]
        or rotation_v6_completion[1] != 'state=successor-installed'
        or rotation_v6_completion[2:18] != rotation_v6_intent[2:18]
        or rotation_v6_completion[18] !=
           f'rotation_intent_sha256={hashlib.sha256(rotation_v6_intent_data).hexdigest()}'
        or rotation_v6_intent_data !=
           ('\n'.join(rotation_v6_intent) + '\n').encode('ascii')
        or rotation_v6_completion_data !=
           ('\n'.join(rotation_v6_completion) + '\n').encode('ascii')
    ):
        reject()
    archived_rotation_v6_predecessor_helper = exact_file(
        f'{rotation_v6_root}/predecessor-helper',
        (0, 0),
        0o400,
        2 * 1024 * 1024,
    )
    if hashlib.sha256(archived_rotation_v6_predecessor_helper).hexdigest() != effective_helper_sha:
        reject()
    effective_release = rotation_v6_release
    effective_helper_sha = rotation_v6_intent[5].split('=', 1)[1]

rotation_v7_intent_data = None
rotation_v7_completion_data = None
archived_rotation_v7_predecessor_helper = None
if os.path.lexists(rotation_v7_parent):
    if (
        rotation_v6_intent_data is None
        or rotation_v6_completion_data is None
        or archived_rotation_v6_predecessor_helper is None
    ):
        reject()
    rotation_v7_parent_value = os.lstat(rotation_v7_parent)
    if (
        not stat.S_ISDIR(rotation_v7_parent_value.st_mode)
        or (rotation_v7_parent_value.st_uid, rotation_v7_parent_value.st_gid,
            stat.S_IMODE(rotation_v7_parent_value.st_mode)) != (0, 0, 0o700)
        or os.path.realpath(rotation_v7_parent) != rotation_v7_parent
    ):
        reject()
    rotation_v7_children = os.listdir(rotation_v7_parent)
    if len(rotation_v7_children) != 1 or release.fullmatch(rotation_v7_children[0]) is None:
        reject()
    rotation_v7_release = rotation_v7_children[0]
    rotation_v7_root = f'{rotation_v7_parent}/{rotation_v7_release}'
    exact_directory(rotation_v7_parent, 0o700, [rotation_v7_release])
    exact_directory(
        rotation_v7_root,
        0o700,
        ['completed-v1', 'intent-v1', 'predecessor-helper'],
    )
    rotation_v7_intent_data = exact_file(
        f'{rotation_v7_root}/intent-v1',
        (0, 0),
        0o600,
        4096,
    )
    rotation_v7_completion_data = exact_file(
        f'{rotation_v7_root}/completed-v1',
        (0, 0),
        0o600,
        4096,
    )
    rotation_v7_intent = rotation_v7_intent_data.decode('ascii').splitlines()
    rotation_v7_completion = rotation_v7_completion_data.decode('ascii').splitlines()
    if (
        len(rotation_v7_intent) != 18
        or len(rotation_v7_completion) != 19
        or rotation_v7_intent[0] !=
           'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v7'
        or rotation_v7_intent[1] != 'state=authorized'
        or rotation_v7_intent[2] != f'predecessor_release={effective_release}'
        or rotation_v7_intent[3] != f'successor_release={rotation_v7_release}'
        or rotation_v7_release in {
            successor,
            rotation_release,
            rotation_v2_release,
            rotation_v3_release,
            rotation_v4_release,
            rotation_v5_release,
            effective_release,
        }
        or rotation_v7_intent[4] !=
           f'predecessor_helper_sha256={effective_helper_sha}'
        or not rotation_v7_intent[5].startswith('successor_helper_sha256=')
        or sha.fullmatch(rotation_v7_intent[5].split('=', 1)[1]) is None
        or rotation_v7_intent[5].split('=', 1)[1] in {
            successor_helper_sha,
            rotation_intent[5].split('=', 1)[1],
            rotation_v2_intent[5].split('=', 1)[1],
            rotation_v3_intent[5].split('=', 1)[1],
            rotation_v4_intent[5].split('=', 1)[1],
            rotation_v5_intent[5].split('=', 1)[1],
            effective_helper_sha,
        }
        or rotation_v7_intent[6] !=
           f'base_successor_intent_sha256={hashlib.sha256(intent_data).hexdigest()}'
        or rotation_v7_intent[7] !=
           f'base_successor_completion_sha256={hashlib.sha256(completion_data).hexdigest()}'
        or rotation_v7_intent[8] != f'base_binding_v2_sha256={v2_sha}'
        or rotation_v7_intent[9] !=
           f'base_predecessor_helper_sha256={hashlib.sha256(old_helper_data).hexdigest()}'
        or rotation_v7_intent[10] != f'base_binding_v3_sha256={v3_sha}'
        or rotation_v7_intent[11] !=
           f'predecessor_rotation_intent_sha256={hashlib.sha256(rotation_v6_intent_data).hexdigest()}'
        or rotation_v7_intent[12] !=
           f'predecessor_rotation_completion_sha256={hashlib.sha256(rotation_v6_completion_data).hexdigest()}'
        or rotation_v7_intent[13] !=
           f'predecessor_rotation_helper_archive_sha256={hashlib.sha256(archived_rotation_v6_predecessor_helper).hexdigest()}'
        or rotation_v7_intent[14] != rotation_v6_intent[14]
        or rotation_v7_intent[15] != rotation_v6_intent[15]
        or rotation_v7_intent[16] != rotation_v6_intent[16]
        or rotation_v7_intent[17] != rotation_v6_intent[17]
        or not rotation_v7_intent[14].startswith('compose5_durable_volume_digest=')
        or sha.fullmatch(rotation_v7_intent[14].split('=', 1)[1]) is None
        or not rotation_v7_intent[15].startswith('compose5_profile_config_hash=')
        or sha.fullmatch(rotation_v7_intent[15].split('=', 1)[1]) is None
        or not rotation_v7_intent[16].startswith('compose5_session_control_config_hash=')
        or sha.fullmatch(rotation_v7_intent[16].split('=', 1)[1]) is None
        or not rotation_v7_intent[17].startswith('compose5_volume_version=')
        or compose_version.fullmatch(rotation_v7_intent[17].split('=', 1)[1]) is None
        or rotation_v7_completion[:1] != rotation_v7_intent[:1]
        or rotation_v7_completion[1] != 'state=successor-installed'
        or rotation_v7_completion[2:18] != rotation_v7_intent[2:18]
        or rotation_v7_completion[18] !=
           f'rotation_intent_sha256={hashlib.sha256(rotation_v7_intent_data).hexdigest()}'
        or rotation_v7_intent_data !=
           ('\n'.join(rotation_v7_intent) + '\n').encode('ascii')
        or rotation_v7_completion_data !=
           ('\n'.join(rotation_v7_completion) + '\n').encode('ascii')
    ):
        reject()
    archived_rotation_v7_predecessor_helper = exact_file(
        f'{rotation_v7_root}/predecessor-helper',
        (0, 0),
        0o400,
        2 * 1024 * 1024,
    )
    if hashlib.sha256(archived_rotation_v7_predecessor_helper).hexdigest() != effective_helper_sha:
        reject()
    effective_release = rotation_v7_release
    effective_helper_sha = rotation_v7_intent[5].split('=', 1)[1]

rotation_v8_intent_data = None
rotation_v8_completion_data = None
archived_rotation_v8_predecessor_helper = None
if os.path.lexists(rotation_v8_parent):
    if (
        rotation_v7_intent_data is None
        or rotation_v7_completion_data is None
        or archived_rotation_v7_predecessor_helper is None
    ):
        reject()
    rotation_v8_parent_value = os.lstat(rotation_v8_parent)
    if (
        not stat.S_ISDIR(rotation_v8_parent_value.st_mode)
        or (rotation_v8_parent_value.st_uid, rotation_v8_parent_value.st_gid,
            stat.S_IMODE(rotation_v8_parent_value.st_mode)) != (0, 0, 0o700)
        or os.path.realpath(rotation_v8_parent) != rotation_v8_parent
    ):
        reject()
    rotation_v8_children = os.listdir(rotation_v8_parent)
    if len(rotation_v8_children) != 1 or release.fullmatch(rotation_v8_children[0]) is None:
        reject()
    rotation_v8_release = rotation_v8_children[0]
    rotation_v8_root = f'{rotation_v8_parent}/{rotation_v8_release}'
    exact_directory(rotation_v8_parent, 0o700, [rotation_v8_release])
    exact_directory(
        rotation_v8_root,
        0o700,
        ['completed-v1', 'intent-v1', 'predecessor-helper'],
    )
    rotation_v8_intent_data = exact_file(
        f'{rotation_v8_root}/intent-v1',
        (0, 0),
        0o600,
        4096,
    )
    rotation_v8_completion_data = exact_file(
        f'{rotation_v8_root}/completed-v1',
        (0, 0),
        0o600,
        4096,
    )
    rotation_v8_intent = rotation_v8_intent_data.decode('ascii').splitlines()
    rotation_v8_completion = rotation_v8_completion_data.decode('ascii').splitlines()
    if (
        len(rotation_v8_intent) != 18
        or len(rotation_v8_completion) != 19
        or rotation_v8_intent[0] !=
           'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v8'
        or rotation_v8_intent[1] != 'state=authorized'
        or rotation_v8_intent[2] != f'predecessor_release={effective_release}'
        or rotation_v8_intent[3] != f'successor_release={rotation_v8_release}'
        or rotation_v8_release in {
            successor,
            rotation_release,
            rotation_v2_release,
            rotation_v3_release,
            rotation_v4_release,
            rotation_v5_release,
            rotation_v6_release,
            effective_release,
        }
        or rotation_v8_intent[4] !=
           f'predecessor_helper_sha256={effective_helper_sha}'
        or not rotation_v8_intent[5].startswith('successor_helper_sha256=')
        or sha.fullmatch(rotation_v8_intent[5].split('=', 1)[1]) is None
        or rotation_v8_intent[5].split('=', 1)[1] in {
            successor_helper_sha,
            rotation_intent[5].split('=', 1)[1],
            rotation_v2_intent[5].split('=', 1)[1],
            rotation_v3_intent[5].split('=', 1)[1],
            rotation_v4_intent[5].split('=', 1)[1],
            rotation_v5_intent[5].split('=', 1)[1],
            rotation_v6_intent[5].split('=', 1)[1],
            effective_helper_sha,
        }
        or rotation_v8_intent[6] !=
           f'base_successor_intent_sha256={hashlib.sha256(intent_data).hexdigest()}'
        or rotation_v8_intent[7] !=
           f'base_successor_completion_sha256={hashlib.sha256(completion_data).hexdigest()}'
        or rotation_v8_intent[8] != f'base_binding_v2_sha256={v2_sha}'
        or rotation_v8_intent[9] !=
           f'base_predecessor_helper_sha256={hashlib.sha256(old_helper_data).hexdigest()}'
        or rotation_v8_intent[10] != f'base_binding_v3_sha256={v3_sha}'
        or rotation_v8_intent[11] !=
           f'predecessor_rotation_intent_sha256={hashlib.sha256(rotation_v7_intent_data).hexdigest()}'
        or rotation_v8_intent[12] !=
           f'predecessor_rotation_completion_sha256={hashlib.sha256(rotation_v7_completion_data).hexdigest()}'
        or rotation_v8_intent[13] !=
           f'predecessor_rotation_helper_archive_sha256={hashlib.sha256(archived_rotation_v7_predecessor_helper).hexdigest()}'
        or rotation_v8_intent[14] != rotation_v7_intent[14]
        or rotation_v8_intent[15] != rotation_v7_intent[15]
        or rotation_v8_intent[16] != rotation_v7_intent[16]
        or rotation_v8_intent[17] != rotation_v7_intent[17]
        or not rotation_v8_intent[14].startswith('compose5_durable_volume_digest=')
        or sha.fullmatch(rotation_v8_intent[14].split('=', 1)[1]) is None
        or not rotation_v8_intent[15].startswith('compose5_profile_config_hash=')
        or sha.fullmatch(rotation_v8_intent[15].split('=', 1)[1]) is None
        or not rotation_v8_intent[16].startswith('compose5_session_control_config_hash=')
        or sha.fullmatch(rotation_v8_intent[16].split('=', 1)[1]) is None
        or not rotation_v8_intent[17].startswith('compose5_volume_version=')
        or compose_version.fullmatch(rotation_v8_intent[17].split('=', 1)[1]) is None
        or rotation_v8_completion[:1] != rotation_v8_intent[:1]
        or rotation_v8_completion[1] != 'state=successor-installed'
        or rotation_v8_completion[2:18] != rotation_v8_intent[2:18]
        or rotation_v8_completion[18] !=
           f'rotation_intent_sha256={hashlib.sha256(rotation_v8_intent_data).hexdigest()}'
        or rotation_v8_intent_data !=
           ('\n'.join(rotation_v8_intent) + '\n').encode('ascii')
        or rotation_v8_completion_data !=
           ('\n'.join(rotation_v8_completion) + '\n').encode('ascii')
    ):
        reject()
    archived_rotation_v8_predecessor_helper = exact_file(
        f'{rotation_v8_root}/predecessor-helper',
        (0, 0),
        0o400,
        2 * 1024 * 1024,
    )
    if hashlib.sha256(archived_rotation_v8_predecessor_helper).hexdigest() != effective_helper_sha:
        reject()
    effective_release = rotation_v8_release
    effective_helper_sha = rotation_v8_intent[5].split('=', 1)[1]

rotation_v9_intent_data = None
rotation_v9_completion_data = None
archived_rotation_v9_predecessor_helper = None
if os.path.lexists(rotation_v9_parent):
    if (
        rotation_v8_intent_data is None
        or rotation_v8_completion_data is None
        or archived_rotation_v8_predecessor_helper is None
    ):
        reject()
    rotation_v9_parent_value = os.lstat(rotation_v9_parent)
    if (
        not stat.S_ISDIR(rotation_v9_parent_value.st_mode)
        or (rotation_v9_parent_value.st_uid, rotation_v9_parent_value.st_gid,
            stat.S_IMODE(rotation_v9_parent_value.st_mode)) != (0, 0, 0o700)
        or os.path.realpath(rotation_v9_parent) != rotation_v9_parent
    ):
        reject()
    rotation_v9_children = os.listdir(rotation_v9_parent)
    if len(rotation_v9_children) != 1 or release.fullmatch(rotation_v9_children[0]) is None:
        reject()
    rotation_v9_release = rotation_v9_children[0]
    rotation_v9_root = f'{rotation_v9_parent}/{rotation_v9_release}'
    exact_directory(rotation_v9_parent, 0o700, [rotation_v9_release])
    exact_directory(
        rotation_v9_root,
        0o700,
        ['completed-v1', 'intent-v1', 'predecessor-helper'],
    )
    rotation_v9_intent_data = exact_file(
        f'{rotation_v9_root}/intent-v1',
        (0, 0),
        0o600,
        4096,
    )
    rotation_v9_completion_data = exact_file(
        f'{rotation_v9_root}/completed-v1',
        (0, 0),
        0o600,
        4096,
    )
    rotation_v9_intent = rotation_v9_intent_data.decode('ascii').splitlines()
    rotation_v9_completion = rotation_v9_completion_data.decode('ascii').splitlines()
    if (
        len(rotation_v9_intent) != 18
        or len(rotation_v9_completion) != 19
        or rotation_v9_intent[0] !=
           'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v9'
        or rotation_v9_intent[1] != 'state=authorized'
        or rotation_v9_intent[2] != f'predecessor_release={effective_release}'
        or rotation_v9_intent[3] != f'successor_release={rotation_v9_release}'
        or rotation_v9_release in {
            successor,
            rotation_release,
            rotation_v2_release,
            rotation_v3_release,
            rotation_v4_release,
            rotation_v5_release,
            rotation_v6_release,
            rotation_v7_release,
            effective_release,
        }
        or rotation_v9_intent[4] !=
           f'predecessor_helper_sha256={effective_helper_sha}'
        or not rotation_v9_intent[5].startswith('successor_helper_sha256=')
        or sha.fullmatch(rotation_v9_intent[5].split('=', 1)[1]) is None
        or rotation_v9_intent[5].split('=', 1)[1] in {
            successor_helper_sha,
            rotation_intent[5].split('=', 1)[1],
            rotation_v2_intent[5].split('=', 1)[1],
            rotation_v3_intent[5].split('=', 1)[1],
            rotation_v4_intent[5].split('=', 1)[1],
            rotation_v5_intent[5].split('=', 1)[1],
            rotation_v6_intent[5].split('=', 1)[1],
            rotation_v7_intent[5].split('=', 1)[1],
            effective_helper_sha,
        }
        or rotation_v9_intent[6] !=
           f'base_successor_intent_sha256={hashlib.sha256(intent_data).hexdigest()}'
        or rotation_v9_intent[7] !=
           f'base_successor_completion_sha256={hashlib.sha256(completion_data).hexdigest()}'
        or rotation_v9_intent[8] != f'base_binding_v2_sha256={v2_sha}'
        or rotation_v9_intent[9] !=
           f'base_predecessor_helper_sha256={hashlib.sha256(old_helper_data).hexdigest()}'
        or rotation_v9_intent[10] != f'base_binding_v3_sha256={v3_sha}'
        or rotation_v9_intent[11] !=
           f'predecessor_rotation_intent_sha256={hashlib.sha256(rotation_v8_intent_data).hexdigest()}'
        or rotation_v9_intent[12] !=
           f'predecessor_rotation_completion_sha256={hashlib.sha256(rotation_v8_completion_data).hexdigest()}'
        or rotation_v9_intent[13] !=
           f'predecessor_rotation_helper_archive_sha256={hashlib.sha256(archived_rotation_v8_predecessor_helper).hexdigest()}'
        or rotation_v9_intent[14] != rotation_v8_intent[14]
        or rotation_v9_intent[15] != rotation_v8_intent[15]
        or rotation_v9_intent[16] != rotation_v8_intent[16]
        or rotation_v9_intent[17] != rotation_v8_intent[17]
        or not rotation_v9_intent[14].startswith('compose5_durable_volume_digest=')
        or sha.fullmatch(rotation_v9_intent[14].split('=', 1)[1]) is None
        or not rotation_v9_intent[15].startswith('compose5_profile_config_hash=')
        or sha.fullmatch(rotation_v9_intent[15].split('=', 1)[1]) is None
        or not rotation_v9_intent[16].startswith('compose5_session_control_config_hash=')
        or sha.fullmatch(rotation_v9_intent[16].split('=', 1)[1]) is None
        or not rotation_v9_intent[17].startswith('compose5_volume_version=')
        or compose_version.fullmatch(rotation_v9_intent[17].split('=', 1)[1]) is None
        or rotation_v9_completion[:1] != rotation_v9_intent[:1]
        or rotation_v9_completion[1] != 'state=successor-installed'
        or rotation_v9_completion[2:18] != rotation_v9_intent[2:18]
        or rotation_v9_completion[18] !=
           f'rotation_intent_sha256={hashlib.sha256(rotation_v9_intent_data).hexdigest()}'
        or rotation_v9_intent_data !=
           ('\n'.join(rotation_v9_intent) + '\n').encode('ascii')
        or rotation_v9_completion_data !=
           ('\n'.join(rotation_v9_completion) + '\n').encode('ascii')
    ):
        reject()
    archived_rotation_v9_predecessor_helper = exact_file(
        f'{rotation_v9_root}/predecessor-helper',
        (0, 0),
        0o400,
        2 * 1024 * 1024,
    )
    if hashlib.sha256(archived_rotation_v9_predecessor_helper).hexdigest() != effective_helper_sha:
        reject()
    effective_release = rotation_v9_release
    effective_helper_sha = rotation_v9_intent[5].split('=', 1)[1]

rotation_v10_intent_data = None
rotation_v10_completion_data = None
archived_rotation_v10_predecessor_helper = None
if os.path.lexists(rotation_v10_parent):
    if (
        rotation_v9_intent_data is None
        or rotation_v9_completion_data is None
        or archived_rotation_v9_predecessor_helper is None
    ):
        reject()
    rotation_v10_parent_value = os.lstat(rotation_v10_parent)
    if (
        not stat.S_ISDIR(rotation_v10_parent_value.st_mode)
        or (rotation_v10_parent_value.st_uid, rotation_v10_parent_value.st_gid,
            stat.S_IMODE(rotation_v10_parent_value.st_mode)) != (0, 0, 0o700)
        or os.path.realpath(rotation_v10_parent) != rotation_v10_parent
    ):
        reject()
    rotation_v10_children = os.listdir(rotation_v10_parent)
    if len(rotation_v10_children) != 1 or release.fullmatch(rotation_v10_children[0]) is None:
        reject()
    rotation_v10_release = rotation_v10_children[0]
    rotation_v10_root = f'{rotation_v10_parent}/{rotation_v10_release}'
    exact_directory(rotation_v10_parent, 0o700, [rotation_v10_release])
    exact_directory(
        rotation_v10_root,
        0o700,
        ['completed-v1', 'intent-v1', 'predecessor-helper'],
    )
    rotation_v10_intent_data = exact_file(
        f'{rotation_v10_root}/intent-v1',
        (0, 0),
        0o600,
        4096,
    )
    rotation_v10_completion_data = exact_file(
        f'{rotation_v10_root}/completed-v1',
        (0, 0),
        0o600,
        4096,
    )
    rotation_v10_intent = rotation_v10_intent_data.decode('ascii').splitlines()
    rotation_v10_completion = rotation_v10_completion_data.decode('ascii').splitlines()
    if (
        len(rotation_v10_intent) != 18
        or len(rotation_v10_completion) != 19
        or rotation_v10_intent[0] !=
           'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v10'
        or rotation_v10_intent[1] != 'state=authorized'
        or rotation_v10_intent[2] != f'predecessor_release={effective_release}'
        or rotation_v10_intent[3] != f'successor_release={rotation_v10_release}'
        or rotation_v10_release in {
            successor,
            rotation_release,
            rotation_v2_release,
            rotation_v3_release,
            rotation_v4_release,
            rotation_v5_release,
            rotation_v6_release,
            rotation_v7_release,
            rotation_v8_release,
            effective_release,
        }
        or rotation_v10_intent[4] !=
           f'predecessor_helper_sha256={effective_helper_sha}'
        or not rotation_v10_intent[5].startswith('successor_helper_sha256=')
        or sha.fullmatch(rotation_v10_intent[5].split('=', 1)[1]) is None
        or rotation_v10_intent[5].split('=', 1)[1] in {
            successor_helper_sha,
            rotation_intent[5].split('=', 1)[1],
            rotation_v2_intent[5].split('=', 1)[1],
            rotation_v3_intent[5].split('=', 1)[1],
            rotation_v4_intent[5].split('=', 1)[1],
            rotation_v5_intent[5].split('=', 1)[1],
            rotation_v6_intent[5].split('=', 1)[1],
            rotation_v7_intent[5].split('=', 1)[1],
            rotation_v8_intent[5].split('=', 1)[1],
            effective_helper_sha,
        }
        or rotation_v10_intent[6] !=
           f'base_successor_intent_sha256={hashlib.sha256(intent_data).hexdigest()}'
        or rotation_v10_intent[7] !=
           f'base_successor_completion_sha256={hashlib.sha256(completion_data).hexdigest()}'
        or rotation_v10_intent[8] != f'base_binding_v2_sha256={v2_sha}'
        or rotation_v10_intent[9] !=
           f'base_predecessor_helper_sha256={hashlib.sha256(old_helper_data).hexdigest()}'
        or rotation_v10_intent[10] != f'base_binding_v3_sha256={v3_sha}'
        or rotation_v10_intent[11] !=
           f'predecessor_rotation_intent_sha256={hashlib.sha256(rotation_v9_intent_data).hexdigest()}'
        or rotation_v10_intent[12] !=
           f'predecessor_rotation_completion_sha256={hashlib.sha256(rotation_v9_completion_data).hexdigest()}'
        or rotation_v10_intent[13] !=
           f'predecessor_rotation_helper_archive_sha256={hashlib.sha256(archived_rotation_v9_predecessor_helper).hexdigest()}'
        or rotation_v10_intent[14] != rotation_v9_intent[14]
        or rotation_v10_intent[15] != rotation_v9_intent[15]
        or rotation_v10_intent[16] != rotation_v9_intent[16]
        or rotation_v10_intent[17] != rotation_v9_intent[17]
        or not rotation_v10_intent[14].startswith('compose5_durable_volume_digest=')
        or sha.fullmatch(rotation_v10_intent[14].split('=', 1)[1]) is None
        or not rotation_v10_intent[15].startswith('compose5_profile_config_hash=')
        or sha.fullmatch(rotation_v10_intent[15].split('=', 1)[1]) is None
        or not rotation_v10_intent[16].startswith('compose5_session_control_config_hash=')
        or sha.fullmatch(rotation_v10_intent[16].split('=', 1)[1]) is None
        or not rotation_v10_intent[17].startswith('compose5_volume_version=')
        or compose_version.fullmatch(rotation_v10_intent[17].split('=', 1)[1]) is None
        or rotation_v10_completion[:1] != rotation_v10_intent[:1]
        or rotation_v10_completion[1] != 'state=successor-installed'
        or rotation_v10_completion[2:18] != rotation_v10_intent[2:18]
        or rotation_v10_completion[18] !=
           f'rotation_intent_sha256={hashlib.sha256(rotation_v10_intent_data).hexdigest()}'
        or rotation_v10_intent_data !=
           ('\n'.join(rotation_v10_intent) + '\n').encode('ascii')
        or rotation_v10_completion_data !=
           ('\n'.join(rotation_v10_completion) + '\n').encode('ascii')
    ):
        reject()
    archived_rotation_v10_predecessor_helper = exact_file(
        f'{rotation_v10_root}/predecessor-helper',
        (0, 0),
        0o400,
        2 * 1024 * 1024,
    )
    if hashlib.sha256(archived_rotation_v10_predecessor_helper).hexdigest() != effective_helper_sha:
        reject()
    effective_release = rotation_v10_release
    effective_helper_sha = rotation_v10_intent[5].split('=', 1)[1]

runtime_bridge_state = 'absent'
runtime_bridge_release = ''
if os.path.lexists(rotation_v11_parent):
    if (
        rotation_v10_intent_data is None
        or rotation_v10_completion_data is None
        or archived_rotation_v10_predecessor_helper is None
    ):
        reject()
    overlay_release = effective_release
    predecessor_helper_sha = effective_helper_sha
    rotation_v11_parent_value = os.lstat(rotation_v11_parent)
    if (
        not stat.S_ISDIR(rotation_v11_parent_value.st_mode)
        or (rotation_v11_parent_value.st_uid, rotation_v11_parent_value.st_gid,
            stat.S_IMODE(rotation_v11_parent_value.st_mode)) != (0, 0, 0o700)
        or os.path.realpath(rotation_v11_parent) != rotation_v11_parent
    ):
        reject()
    rotation_v11_children = os.listdir(rotation_v11_parent)
    if len(rotation_v11_children) != 1 or release.fullmatch(rotation_v11_children[0]) is None:
        reject()
    rotation_v11_release = rotation_v11_children[0]
    if rotation_v11_release == overlay_release:
        reject()
    rotation_v11_root = f'{rotation_v11_parent}/{rotation_v11_release}'
    exact_directory(rotation_v11_parent, 0o700, [rotation_v11_release])
    exact_directory(
        rotation_v11_root,
        0o700,
        ['completed-v1', 'intent-v1', 'predecessor-helper'],
    )
    rotation_v11_intent_data = exact_file(
        f'{rotation_v11_root}/intent-v1',
        (0, 0),
        0o600,
        4096,
    )
    rotation_v11_completion_data = exact_file(
        f'{rotation_v11_root}/completed-v1',
        (0, 0),
        0o600,
        4096,
    )
    rotation_v11_intent = rotation_v11_intent_data.decode('ascii').splitlines()
    rotation_v11_completion = rotation_v11_completion_data.decode('ascii').splitlines()
    if (
        len(rotation_v11_intent) != 21
        or len(rotation_v11_completion) != 22
        or rotation_v11_intent[0] !=
           'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v11'
        or rotation_v11_intent[1] != 'state=authorized'
        or rotation_v11_intent[2] != f'overlay_release={overlay_release}'
        or rotation_v11_intent[3] != f'bridge_release={rotation_v11_release}'
        or rotation_v11_intent[4] !=
           f'predecessor_helper_sha256={predecessor_helper_sha}'
        or not rotation_v11_intent[5].startswith('successor_helper_sha256=')
        or sha.fullmatch(rotation_v11_intent[5].split('=', 1)[1]) is None
        or rotation_v11_intent[5].split('=', 1)[1] == predecessor_helper_sha
        or rotation_v11_intent[6] !=
           f'predecessor_rotation_intent_sha256={hashlib.sha256(rotation_v10_intent_data).hexdigest()}'
        or rotation_v11_intent[7] !=
           f'predecessor_rotation_completion_sha256={hashlib.sha256(rotation_v10_completion_data).hexdigest()}'
        or rotation_v11_intent[8] !=
           f'predecessor_rotation_helper_archive_sha256={hashlib.sha256(archived_rotation_v10_predecessor_helper).hexdigest()}'
        or rotation_v11_intent[9] != f'base_binding_v3_sha256={v3_sha}'
        or rotation_v11_intent[10] != rotation_v10_intent[14]
        or rotation_v11_intent[11] != rotation_v10_intent[15]
        or rotation_v11_intent[12] != rotation_v10_intent[16]
        or rotation_v11_intent[13] != rotation_v10_intent[17]
        or rotation_v11_intent[14] !=
           'transition=historical-overlay-current-runtime-separated-v1'
        or rotation_v11_intent[15] != 'financial_actions_mode=dry_run'
        or rotation_v11_intent[16] != 'kemerbet_executor_enabled=false'
        or rotation_v11_intent[17] != 'kemerbet_final_action_enabled=false'
        or rotation_v11_intent[18] != 'transfer_enabled=false'
        or rotation_v11_intent[19] != 'lookup_authorized=false'
        or rotation_v11_intent[20] != 'recheck_authorized=false'
        or not rotation_v11_intent[10].startswith('compose5_durable_volume_digest=')
        or sha.fullmatch(rotation_v11_intent[10].split('=', 1)[1]) is None
        or not rotation_v11_intent[11].startswith('compose5_profile_config_hash=')
        or sha.fullmatch(rotation_v11_intent[11].split('=', 1)[1]) is None
        or not rotation_v11_intent[12].startswith('compose5_session_control_config_hash=')
        or sha.fullmatch(rotation_v11_intent[12].split('=', 1)[1]) is None
        or not rotation_v11_intent[13].startswith('compose5_volume_version=')
        or compose_version.fullmatch(rotation_v11_intent[13].split('=', 1)[1]) is None
        or rotation_v11_completion[:1] != rotation_v11_intent[:1]
        or rotation_v11_completion[1] != 'state=runtime-bridge-installed'
        or rotation_v11_completion[2:21] != rotation_v11_intent[2:21]
        or rotation_v11_completion[21] !=
           f'rotation_intent_sha256={hashlib.sha256(rotation_v11_intent_data).hexdigest()}'
        or rotation_v11_intent_data !=
           ('\n'.join(rotation_v11_intent) + '\n').encode('ascii')
        or rotation_v11_completion_data !=
           ('\n'.join(rotation_v11_completion) + '\n').encode('ascii')
    ):
        reject()
    archived_rotation_v11_predecessor_helper = exact_file(
        f'{rotation_v11_root}/predecessor-helper',
        (0, 0),
        0o400,
        2 * 1024 * 1024,
    )
    if hashlib.sha256(archived_rotation_v11_predecessor_helper).hexdigest() != predecessor_helper_sha:
        reject()
    effective_helper_sha = rotation_v11_intent[5].split('=', 1)[1]
    runtime_bridge_state = 'active'
    runtime_bridge_release = rotation_v11_release

exact_directory(retirement, 0o700, ['completed-v1', 'intent-v1'])
retirement_intent_data = exact_file(f'{retirement}/intent-v1', (0, 0), 0o600, 4096)
retirement_completion_data = exact_file(f'{retirement}/completed-v1', (0, 0), 0o600, 4096)
retirement_intent = retirement_intent_data.decode('ascii').splitlines()
retirement_completion = retirement_completion_data.decode('ascii').splitlines()
if (
    len(retirement_intent) != 14
    or len(retirement_completion) != 16
    or retirement_intent[0] != 'contract=fetanagent-kemerbet-readiness-binding-v1-retirement-v1'
    or retirement_intent[1] != 'state=retirement-authorized'
    or retirement_intent[2] != f'release={predecessor}'
    or retirement_intent[4] != f'helper_sha256={predecessor_helper_sha}'
    or not retirement_intent[9].startswith('claim_sha256=')
    or sha.fullmatch(retirement_intent[9].split('=', 1)[1]) is None
    or retirement_completion[:1] != retirement_intent[:1]
    or retirement_completion[1] != 'state=resealed-v2'
    or retirement_completion[2:14] != retirement_intent[2:14]
    or retirement_completion[15] != f'v2_binding_sha256={v2_sha}'
    or hashlib.sha256(retirement_intent_data).hexdigest() != retirement_intent_sha
    or hashlib.sha256(retirement_completion_data).hexdigest() != retirement_completion_sha
    or retirement_intent_data != ('\n'.join(retirement_intent) + '\n').encode('ascii')
    or retirement_completion_data != ('\n'.join(retirement_completion) + '\n').encode('ascii')
):
    reject()

identity_key_stat = os.stat(identity_key, follow_symlinks=False)
identity_key_owner_mode = (
    identity_key_stat.st_uid,
    identity_key_stat.st_gid,
    stat.S_IMODE(identity_key_stat.st_mode),
)
if identity_key_owner_mode == (0, 0, 0o444):
    identity_key_data = exact_file(identity_key, (0, 0), 0o444, 64, 64)
elif identity_key_owner_mode == (10001, 10001, 0o400):
    identity_key_data = exact_file(identity_key, (10001, 10001), 0o400, 64, 64)
else:
    reject()
if (
    retirement_intent[7] != f'identity_hmac_key_dev_ino={identity_key_stat.st_dev}:{identity_key_stat.st_ino}'
    or retirement_intent[8] != f'identity_hmac_key_sha256={hashlib.sha256(identity_key_data).hexdigest()}'
):
    reject()

def require_live_successor_helper():
    helper_data = exact_file(helper, (0, 0), 0o755, 2 * 1024 * 1024)
    if hashlib.sha256(helper_data).hexdigest() != effective_helper_sha:
        reject()


def require_v3_binding(path, owner, mode):
    data = exact_file(path, owner, mode, 230, 230)
    matched = v3.fullmatch(data)
    if (
        hashlib.sha256(data).hexdigest() != v3_sha
        or matched is None
        or v2_match.group(1) != matched.group(1)
        or v2_match.group(2) != matched.group(2)
    ):
        reject()
    return data


def promotion_exists_and_is_safe():
    if not os.path.lexists(promotion_root):
        return False
    value = os.lstat(promotion_root)
    if (
        not stat.S_ISDIR(value.st_mode)
        or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode)) != (0, 0, 0o700)
        or os.path.realpath(promotion_root) != promotion_root
    ):
        reject()
    return True


promotion_exists = promotion_exists_and_is_safe()
if promotion_exists:
    # Classification is deliberately limited to the immutable successor evidence plus a safe,
    # canonical promotion root. The guarded recheck recovery path validates the exact journal and
    # every phase-specific artifact before it performs any mutation. This keeps every crash point
    # recoverable, including the interval after the one-use source is consumed but before the final
    # binding and receipt have both been published.
    require_live_successor_helper()
    gate_state = 'successor-recheck-recoverable'
elif os.path.lexists(binding):
    require_v3_binding(binding, (10001, 10001), 0o600)
    require_live_successor_helper()
    if (
        os.path.lexists(committed_binding)
        or os.path.lexists(os.path.dirname(recheck_receipt))
        or os.path.lexists(owner_completion)
        or os.path.lexists(candidate_root)
        or os.path.lexists(rpc_root)
    ):
        reject()
    gate_state = 'successor-installed'
else:
    require_v3_binding(committed_binding, (0, 0), 0o444)
    exact_directory(os.path.dirname(recheck_receipt), 0o700, ['ready-v1'])
    receipt_data = exact_file(recheck_receipt, (0, 0), 0o600, 4096)
    receipt_lines = receipt_data.decode('ascii').splitlines()
    if identity_key_owner_mode != (0, 0, 0o444):
        reject()
    selector_data = exact_file(selector_contract, (0, 0), 0o444, 1024 * 1024)
    if (
        len(receipt_lines) != 8
        or receipt_lines[0] != 'version=1'
        or receipt_lines[1] != f'release={effective_release}'
        or receipt_lines[2] != f'binding_sha256={v3_sha}'
        or receipt_lines[3] !=
           f'identity_hmac_key_sha256={hashlib.sha256(identity_key_data).hexdigest()}'
        or receipt_lines[4] != f'selector_sha256={hashlib.sha256(selector_data).hexdigest()}'
        or re.fullmatch(r'image_id=sha256:[0-9a-f]{64}', receipt_lines[5]) is None
        or receipt_lines[6] != 'profile_volume=fetanagent-staging-beta_kemerbet_sessions'
        or not receipt_lines[7].startswith('profile_identity_sha256=')
        or sha.fullmatch(receipt_lines[7].split('=', 1)[1]) is None
        or receipt_data != ('\n'.join(receipt_lines) + '\n').encode('ascii')
    ):
        reject()

    exact_directory(
        os.path.dirname(owner_completion),
        0o755,
        [os.path.basename(owner_completion)],
    )
    owner_completion_data = exact_file(owner_completion, (0, 10001), 0o440, 37, 37)
    if (
        claim.fullmatch(owner_completion_data) is None
        or hashlib.sha256(owner_completion_data).hexdigest() !=
           retirement_intent[9].split('=', 1)[1]
    ):
        reject()
    for consumed_or_transient in (
        binding,
        readiness_player_ids,
        candidate_root,
        promotion_root,
        rpc_root,
    ):
        if os.path.lexists(consumed_or_transient):
            reject()
    gate_state = 'successor-completed'

sys.stdout.write(
    effective_release + '\n' + effective_helper_sha + '\n' + gate_state + '\n' +
    runtime_bridge_state + '\n' + runtime_bridge_release + '\n'
)
PY
)" || return 0
  mapfile -t inspection_lines <<<"$inspection"
  [[ "${#inspection_lines[@]}" -eq 5 && "${inspection_lines[0]}" =~ ^[0-9a-f]{40}$ &&
    "${inspection_lines[1]}" =~ ^[0-9a-f]{64}$ &&
    "${inspection_lines[2]}" =~ ^(successor-installed|successor-recheck-recoverable|successor-completed)$ &&
    "${inspection_lines[3]}" == 'active' &&
    "${inspection_lines[4]}" =~ ^[0-9a-f]{40}$ ]] || return 0
  KEMERBET_V2_V3_SUCCESSOR_RELEASE="${inspection_lines[0]}"
  KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256="${inspection_lines[1]}"
  KEMERBET_V2_V3_SUCCESSOR_GATE_STATE="${inspection_lines[2]}"
  KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE="${inspection_lines[3]}"
  KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE="${inspection_lines[4]}"
}

enforce_kemerbet_v2_v3_successor_gate() {
  local command="$1" release=''
  if [[ "$command" =~ ^(verify|kemerbet-v3-runtime-bridge-ready|docker-storage-ready)$ ]]; then
    return 0
  fi
  inspect_kemerbet_v2_v3_successor_gate
  [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" != 'absent' ]] || return 0
  if [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'successor-completed' ]]; then
    case "$command" in
      retire-kemerbet-readiness-binding-v1-for-v2-reseal|reinstall-kemerbet-v1-retirement-secrets|seal-kemerbet-readiness|kemerbet-v1-retirement-recovery-ready)
        die 'the completed KemerBet v3 successor permanently forbids legacy v1/v2 reseal or recovery commands'
        ;;
      stop-bot|stop-kemerbet-session-provision)
        # The completed overlay records the historical migration release. The
        # command handler separately proves the current component release and
        # re-attests this unchanged terminal overlay around the stop.
        return 0
        ;;
      recheck-kemerbet-readiness)
        release="${2:-}"
        [[ "$release" == "$KEMERBET_V2_V3_SUCCESSOR_RELEASE" ]] ||
          die 'the completed KemerBet v3 successor recheck belongs to another reviewed release'
        return 0
        ;;
      *) return 0 ;;
    esac
  fi
  case "$command" in
    stop|expiry-stop|stop-public-edge)
      return 0
      ;;
    stop-bot|stop-kemerbet-session-provision)
      release="${2:-}"
      if [[ "$KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE" == 'active' ]]; then
        [[ "$release" =~ ^[0-9a-f]{40}$ ]] ||
          die 'the KemerBet v3 runtime component stop release is invalid'
      else
        [[ "$release" == "$KEMERBET_V2_V3_SUCCESSOR_RELEASE" ]] ||
          die 'the KemerBet v3 successor stop command belongs to another reviewed release'
      fi
      return 0
      ;;
  esac
  if [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'successor-recheck-recoverable' ]]; then
    release="${2:-}"
    [[ "$command" == 'recheck-kemerbet-readiness' &&
      "$release" == "$KEMERBET_V2_V3_SUCCESSOR_RELEASE" ]] ||
      die 'an interrupted KemerBet v3 recheck permits only exact-release recovery'
    return 0
  fi
  [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'successor-installed' ]] ||
    die 'an incomplete or invalid KemerBet v2-to-v3 successor migration blocks staging mutations'
  case "$command" in
    network-ready)
      return 0
      ;;
    recheck-kemerbet-readiness|kemerbet-v3-successor-ready)
      release="${2:-}"
      [[ "$release" == "$KEMERBET_V2_V3_SUCCESSOR_RELEASE" ]] ||
        die 'the KemerBet v3 lookup/recheck boundary is bound to another reviewed release'
      return 0
      ;;
    install|fresh-start|fresh-host-ready|arm-expiry-stop|bot-disabled-ready|install-bot-token|start-bot|bot-ready|fresh-public-edge-ready|start-fresh-public-edge|diagnose-owner-startup|discard|stop-bot|start-kemerbet-session-provision|kemerbet-session-provision-ready|stop-kemerbet-session-provision)
      release="${2:-}"
      if [[ "$KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE" == 'active' ]]; then
        [[ "$release" =~ ^[0-9a-f]{40}$ ]] ||
          die 'the reviewed current runtime release is invalid'
      else
        [[ "$release" == "$KEMERBET_V2_V3_SUCCESSOR_RELEASE" ]] ||
          die 'the KemerBet v3 successor gate is bound to another reviewed release'
      fi
      return 0
      ;;
    *)
      die 'the KemerBet v3 successor gate permits only no-transfer deployment, private sign-in, and readiness recheck'
      ;;
  esac
}

require_kemerbet_v3_runtime_bridge() {
  inspect_kemerbet_v2_v3_successor_gate
  [[ "$KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE" == 'active' &&
    "$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE" =~ ^[0-9a-f]{40}$ &&
    "$KEMERBET_V2_V3_SUCCESSOR_RELEASE" =~ ^[0-9a-f]{40}$ &&
    "$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256" =~ ^[0-9a-f]{64}$ &&
    "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" =~ ^(successor-installed|successor-completed)$ ]] ||
    die 'the future-release-neutral KemerBet v3 runtime bridge is unavailable or invalid'
}

consume_exact_one_use_kemerbet_file() {
  local path="$1" expected_dev_ino="$2" expected_digest="$3"
  local digest_fd python_status
  exec {digest_fd}<<<"$expected_digest" || return 1
  if env -i PATH="$SAFE_PATH" python3 -I - \
    "$path" "$expected_dev_ino" "$digest_fd" <<'PY'
import hashlib
import os
import re
import stat
import sys

DEV_INO = re.compile(r'([0-9]+):([0-9]+)')
DIGEST = re.compile(r'[0-9a-f]{64}')
CONTRACTS = {
    '/etc/fetanagent/executor-secrets/kemerbet_no_transfer_readiness_player_ids': (
        (0, 0, 0o700),
        {
            (10001, 10001, 0o400),
            (10001, 10001, 0o444),
            (0, 0, 0o400),
            (0, 0, 0o444),
        },
    ),
    '/var/lib/fetanagent/kemerbet-readiness-seal-output/kemerbet_agent_identity_bindings': (
        (10001, 10001, 0o700),
        {(10001, 10001, 0o600)},
    ),
}


def reject():
    raise RuntimeError()


def mode(value):
    return stat.S_IMODE(value.st_mode)


def read_private_digest(descriptor_text):
    if not descriptor_text.isascii() or not descriptor_text.isdecimal():
        reject()
    descriptor = int(descriptor_text, 10)
    if descriptor < 3 or descriptor > 1024:
        reject()
    try:
        content = os.read(descriptor, 66)
    finally:
        os.close(descriptor)
    if len(content) != 65 or not content.endswith(b'\n'):
        reject()
    try:
        value = content[:-1].decode('ascii')
    except UnicodeDecodeError:
        reject()
    if DIGEST.fullmatch(value) is None:
        reject()
    return value


def consume(path, expected_identity_text, expected_digest):
    contract = CONTRACTS.get(path)
    match = DEV_INO.fullmatch(expected_identity_text)
    if contract is None or match is None or DIGEST.fullmatch(expected_digest) is None:
        reject()
    expected_identity = (int(match.group(1)), int(match.group(2)))
    directory = os.path.dirname(path)
    name = os.path.basename(path)
    directory_descriptor = os.open(
        directory,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
    )
    descriptor = None
    try:
        opened_directory = os.fstat(directory_descriptor)
        named_directory = os.lstat(directory)
        if (
            not stat.S_ISDIR(opened_directory.st_mode)
            or not stat.S_ISDIR(named_directory.st_mode)
            or (opened_directory.st_dev, opened_directory.st_ino)
            != (named_directory.st_dev, named_directory.st_ino)
            or (opened_directory.st_uid, opened_directory.st_gid, mode(opened_directory))
            != contract[0]
            or named_directory.st_mode != opened_directory.st_mode
            or named_directory.st_uid != opened_directory.st_uid
            or named_directory.st_gid != opened_directory.st_gid
            or os.path.realpath(directory) != directory
        ):
            reject()
        try:
            named = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
        except FileNotFoundError:
            try:
                os.lstat(path)
            except FileNotFoundError:
                return
            reject()
        absolute = os.lstat(path)
        if (
            not stat.S_ISREG(named.st_mode)
            or (named.st_dev, named.st_ino) != expected_identity
            or (absolute.st_dev, absolute.st_ino) != expected_identity
            or named.st_mode != absolute.st_mode
            or named.st_uid != absolute.st_uid
            or named.st_gid != absolute.st_gid
            or named.st_nlink != 1
            or absolute.st_nlink != 1
            or named.st_size != absolute.st_size
            or (named.st_uid, named.st_gid, mode(named)) not in contract[1]
            or named.st_size < 1
            or named.st_size > 4096
        ):
            reject()
        descriptor = os.open(
            name,
            os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
            dir_fd=directory_descriptor,
        )
        opened = os.fstat(descriptor)
        content = os.pread(descriptor, named.st_size + 1, 0)
        if (
            (opened.st_dev, opened.st_ino) != expected_identity
            or opened.st_mode != named.st_mode
            or opened.st_uid != named.st_uid
            or opened.st_gid != named.st_gid
            or opened.st_nlink != 1
            or opened.st_size != named.st_size
            or len(content) != named.st_size
            or hashlib.sha256(content).hexdigest() != expected_digest
        ):
            reject()
        named_again = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
        if (
            (named_again.st_dev, named_again.st_ino) != expected_identity
            or named_again.st_mode != opened.st_mode
            or named_again.st_uid != opened.st_uid
            or named_again.st_gid != opened.st_gid
            or named_again.st_nlink != 1
            or named_again.st_size != opened.st_size
        ):
            reject()
        os.unlink(name, dir_fd=directory_descriptor)
        os.fsync(directory_descriptor)
        try:
            os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
        except FileNotFoundError:
            try:
                os.lstat(path)
            except FileNotFoundError:
                return
        reject()
    finally:
        if descriptor is not None:
            os.close(descriptor)
        os.close(directory_descriptor)


try:
    if len(sys.argv) != 4:
        reject()
    consume(sys.argv[1], sys.argv[2], read_private_digest(sys.argv[3]))
except Exception:
    raise SystemExit(1)
PY
  then
    python_status=0
  else
    python_status=$?
  fi
  exec {digest_fd}<&- || return 1
  return "$python_status"
}

remove_kemerbet_recheck_container() {
  local container_id container_name expected_oneshot expected_service observed_contract
  for container_name in \
    "$KEMERBET_RECHECK_CONTAINER" \
    "$KEMERBET_RECHECK_BROWSER_CONTAINER" \
    "$KEMERBET_RECHECK_PROXY_CONTAINER" \
    "$KEMERBET_RECHECK_AUTHORIZER_CONTAINER" \
    "$KEMERBET_RECHECK_SNAPSHOT_CONTAINER" \
    "$KEMERBET_RECHECK_SNAPSHOT_VERIFY_CONTAINER" \
    "$KEMERBET_RECHECK_ORIGINAL_VERIFY_CONTAINER"; do
    expected_service=''
    expected_oneshot=''
    case "$container_name" in
      "$KEMERBET_RECHECK_CONTAINER") expected_service='kemerbet-no-transfer-readiness' ;;
      "$KEMERBET_RECHECK_BROWSER_CONTAINER") expected_service='kemerbet-readiness-browser' ;;
      "$KEMERBET_RECHECK_PROXY_CONTAINER") expected_service='kemerbet-readiness-egress-proxy' ;;
      "$KEMERBET_RECHECK_AUTHORIZER_CONTAINER") expected_oneshot='authorization-premint-v1' ;;
      "$KEMERBET_RECHECK_SNAPSHOT_CONTAINER") expected_oneshot='profile-snapshot-copy-v1' ;;
      "$KEMERBET_RECHECK_SNAPSHOT_VERIFY_CONTAINER") expected_oneshot='profile-snapshot-verify-v1' ;;
      "$KEMERBET_RECHECK_ORIGINAL_VERIFY_CONTAINER") expected_oneshot='profile-original-verify-v1' ;;
      *) return 1 ;;
    esac
    container_id="$(docker_local container ls --all --quiet \
      --filter "name=^/${container_name}$")" || return 1
    if [[ -z "$container_id" ]]; then
      continue
    fi
    [[ "$container_id" =~ ^[0-9a-f]{12,64}$ ]] || return 1
    if [[ -n "$expected_service" ]]; then
      observed_contract="$(docker_local container inspect "$container_id" \
        --format '{{ index .Config.Labels "com.docker.compose.project" }}|{{ index .Config.Labels "com.docker.compose.service" }}')" ||
        return 1
      [[ "$observed_contract" == "$PROJECT_NAME|$expected_service" ]] || return 1
    else
      observed_contract="$(docker_local container inspect "$container_id" \
        --format '{{ index .Config.Labels "com.docker.compose.project" }}|{{ index .Config.Labels "com.fetanagent.kemerbet-readiness.oneshot" }}')" ||
        return 1
      [[ "$observed_contract" == "$PROJECT_NAME|$expected_oneshot" ]] || return 1
    fi
    docker_local container rm --force "$container_id" >/dev/null 2>&1 || return 1
    container_id="$(docker_local container ls --all --quiet \
      --filter "name=^/${container_name}$")" || return 1
    [[ -z "$container_id" ]] || return 1
  done
  remove_kemerbet_recheck_profile_snapshot_volume
}

resolve_kemerbet_recheck_profile_snapshot_mountpoint() {
  local expected_owner="$1" labels mountpoint volume_name
  [[ "$expected_owner" == '0:0:700' || "$expected_owner" == '0:0:755' ||
    "$expected_owner" == '10001:10001:700' ]] || return 1
  volume_name="$(docker_local volume ls --quiet \
    --filter "name=^${KEMERBET_RECHECK_PROFILE_SNAPSHOT_VOLUME}$")" || return 1
  [[ "$volume_name" == "$KEMERBET_RECHECK_PROFILE_SNAPSHOT_VOLUME" ]] || return 1
  [[ "$(docker_local volume inspect "$volume_name" \
    --format '{{.Name}}|{{.Driver}}|{{.Scope}}|{{ index .Labels "com.docker.compose.project" }}|{{ index .Labels "com.docker.compose.volume" }}|{{ index .Labels "com.fetanagent.kemerbet-readiness.snapshot" }}')" == \
    "$volume_name|local|local|$PROJECT_NAME|kemerbet_readiness_profile_snapshot|profile-snapshot-v1" ]] ||
    return 1
  labels="$(docker_local volume inspect "$volume_name" \
    --format '{{range $key, $value := .Labels}}{{printf "%s=%s\n" $key $value}}{{end}}' | \
    LC_ALL=C sed '/^$/d' | \
    LC_ALL=C sort)" ||
    return 1
  [[ "$labels" == "$(printf '%s\n' \
    "com.docker.compose.project=$PROJECT_NAME" \
    'com.docker.compose.volume=kemerbet_readiness_profile_snapshot' \
    "$KEMERBET_RECHECK_SNAPSHOT_VOLUME_LABEL=profile-snapshot-v1" | LC_ALL=C sort)" ]] || return 1
  [[ "$(docker_local volume inspect "$volume_name" --format '{{json .Options}}')" == 'null' ]] ||
    return 1
  mountpoint="$(docker_local volume inspect "$volume_name" --format '{{.Mountpoint}}')" || return 1
  [[ "$mountpoint" == /var/lib/docker/volumes/*/_data && ! -L "$mountpoint" && -d "$mountpoint" &&
    "$(realpath -- "$mountpoint")" == "$mountpoint" &&
    "$(stat --format='%u:%g:%a' "$mountpoint")" == "$expected_owner" ]] || return 1
  printf '%s' "$mountpoint"
}

kemerbet_recheck_profile_snapshot_volume_holders_match() {
  local expected="$1" holders
  holders="$(docker_local container ls --all --no-trunc --quiet \
    --filter "volume=$KEMERBET_RECHECK_PROFILE_SNAPSHOT_VOLUME" | LC_ALL=C sort)" || return 1
  [[ "$holders" == "$expected" ]]
}

kemerbet_recheck_original_profile_volume_holders_match() {
  local expected="$1" holders
  holders="$(docker_local container ls --all --no-trunc --quiet \
    --filter "volume=$KEMERBET_PROFILE_VOLUME" | LC_ALL=C sort)" || return 1
  [[ "$holders" == "$expected" ]]
}

remove_kemerbet_recheck_profile_snapshot_volume() {
  local holders labels mountpoint volume_name
  volume_name="$(docker_local volume ls --quiet \
    --filter "name=^${KEMERBET_RECHECK_PROFILE_SNAPSHOT_VOLUME}$")" || return 1
  [[ -z "$volume_name" ]] && return 0
  [[ "$volume_name" == "$KEMERBET_RECHECK_PROFILE_SNAPSHOT_VOLUME" ]] || return 1
  holders="$(docker_local container ls --all --quiet --filter "volume=$volume_name")" || return 1
  [[ -z "$holders" ]] || return 1
  [[ "$(docker_local volume inspect "$volume_name" \
    --format '{{.Name}}|{{.Driver}}|{{.Scope}}|{{ index .Labels "com.docker.compose.project" }}|{{ index .Labels "com.docker.compose.volume" }}|{{ index .Labels "com.fetanagent.kemerbet-readiness.snapshot" }}')" == \
    "$volume_name|local|local|$PROJECT_NAME|kemerbet_readiness_profile_snapshot|profile-snapshot-v1" ]] ||
    return 1
  labels="$(docker_local volume inspect "$volume_name" \
    --format '{{range $key, $value := .Labels}}{{printf "%s=%s\n" $key $value}}{{end}}' | \
    LC_ALL=C sed '/^$/d' | \
    LC_ALL=C sort)" ||
    return 1
  [[ "$labels" == "$(printf '%s\n' \
    "com.docker.compose.project=$PROJECT_NAME" \
    'com.docker.compose.volume=kemerbet_readiness_profile_snapshot' \
    "$KEMERBET_RECHECK_SNAPSHOT_VOLUME_LABEL=profile-snapshot-v1" | LC_ALL=C sort)" ]] || return 1
  [[ "$(docker_local volume inspect "$volume_name" --format '{{json .Options}}')" == 'null' ]] ||
    return 1
  mountpoint="$(docker_local volume inspect "$volume_name" --format '{{.Mountpoint}}')" || return 1
  [[ "$mountpoint" == "/var/lib/docker/volumes/$volume_name/_data" &&
    ! -L "$mountpoint" && -d "$mountpoint" && "$(realpath -- "$mountpoint")" == "$mountpoint" ]] ||
    return 1
  # Ownership/mode are deliberately not a deletion precondition: root:root 0755 is Docker's
  # just-created state, root:root 0700 is the offline-copy state, and 10001:10001 0700 is the
  # verified browser handoff. If a failed trusted one-shot or browser changed only those metadata,
  # this exact labeled, holder-free disposable volume must still be destroyed rather than retain
  # copied session bytes.
  docker_local volume rm "$volume_name" >/dev/null 2>&1 || return 1
  [[ -z "$(docker_local volume ls --quiet --filter "name=^${volume_name}$")" ]]
}

create_kemerbet_recheck_profile_snapshot_volume() {
  local entry mountpoint volume_name
  [[ -z "$(docker_local volume ls --quiet \
    --filter "name=^${KEMERBET_RECHECK_PROFILE_SNAPSHOT_VOLUME}$")" ]] || return 1
  volume_name="$(docker_local volume create \
    --driver local \
    --label "com.docker.compose.project=$PROJECT_NAME" \
    --label 'com.docker.compose.volume=kemerbet_readiness_profile_snapshot' \
    --label "$KEMERBET_RECHECK_SNAPSHOT_VOLUME_LABEL=profile-snapshot-v1" \
    "$KEMERBET_RECHECK_PROFILE_SNAPSHOT_VOLUME")" || return 1
  [[ "$volume_name" == "$KEMERBET_RECHECK_PROFILE_SNAPSHOT_VOLUME" ]] || return 1
  mountpoint="$(docker_local volume inspect "$volume_name" --format '{{.Mountpoint}}')" || return 1
  [[ "$mountpoint" == /var/lib/docker/volumes/*/_data && ! -L "$mountpoint" && -d "$mountpoint" &&
    "$(realpath -- "$mountpoint")" == "$mountpoint" &&
    "$(stat --format='%u:%g' "$mountpoint")" == '0:0' ]] || return 1
  while IFS= read -r entry; do
    [[ -z "$entry" ]] || return 1
  done < <(find -P "$mountpoint" -mindepth 1 -maxdepth 1 -printf '%f\n')
  chmod 0700 "$mountpoint" || return 1
  sync -f "$mountpoint" || return 1
  resolve_kemerbet_recheck_profile_snapshot_mountpoint '0:0:700' >/dev/null
}

remove_kemerbet_recheck_network() {
  local expected_label network_id network_name
  for network_name in \
    "$KEMERBET_RECHECK_EGRESS_NETWORK" \
    "$KEMERBET_RECHECK_PROXY_NETWORK" \
    "$KEMERBET_RECHECK_CONTROL_NETWORK"; do
    case "$network_name" in
      "$KEMERBET_RECHECK_EGRESS_NETWORK") expected_label='kemerbet_readiness_egress' ;;
      "$KEMERBET_RECHECK_PROXY_NETWORK") expected_label='kemerbet_readiness_proxy' ;;
      "$KEMERBET_RECHECK_CONTROL_NETWORK") expected_label='kemerbet_readiness_control' ;;
      *) return 1 ;;
    esac
    network_id="$(docker_local network ls --quiet --filter "name=^${network_name}$")" || return 1
    if [[ -z "$network_id" ]]; then
      continue
    fi
    [[ "$network_id" =~ ^[0-9a-f]{12,64}$ ]] || return 1
    [[ "$(docker_local network inspect "$network_id" \
      --format '{{.Name}}|{{ index .Labels "com.docker.compose.project" }}|{{ index .Labels "com.docker.compose.network" }}')" == \
      "$network_name|$PROJECT_NAME|$expected_label" ]] || return 1
    docker_local network rm "$network_id" >/dev/null 2>&1 || return 1
    network_id="$(docker_local network ls --quiet --filter "name=^${network_name}$")" || return 1
    [[ -z "$network_id" ]] || return 1
  done
}

require_kemerbet_recheck_network_ipam_contract() {
  local network_id="$1" expected_ipv4_subnet="$2" expected_ipv4_gateway="$3"
  local expected_ipv6_subnet="$4" expected_ipv6_gateway="$5" observed_ipam_json
  [[ "$network_id" =~ ^[0-9a-f]{12,64}$ && -n "$expected_ipv4_subnet" &&
    -n "$expected_ipv4_gateway" && -n "$expected_ipv6_subnet" &&
    -n "$expected_ipv6_gateway" ]] || return 1
  observed_ipam_json="$(docker_local network inspect "$network_id" \
    --format '{{json .IPAM.Config}}')" || return 1
  [[ -n "$observed_ipam_json" && ${#observed_ipam_json} -le 4096 &&
    "$observed_ipam_json" != *$'\n'* && "$observed_ipam_json" != *$'\r'* ]] || return 1
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$observed_ipam_json" \
    "$expected_ipv4_subnet" "$expected_ipv4_gateway" \
    "$expected_ipv6_subnet" "$expected_ipv6_gateway" <<'PY'
import json
import sys


def reject():
    raise SystemExit(1)


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError('duplicate JSON key')
        value[key] = item
    return value


if len(sys.argv) != 6:
    reject()
raw = sys.argv[1]
if raw != raw.strip() or len(raw.encode('utf-8')) > 4096:
    reject()
try:
    configs = json.loads(raw, object_pairs_hook=unique_object)
except Exception:
    reject()
if type(configs) is not list or len(configs) != 2:
    reject()

allowed_keys = {'AuxiliaryAddresses', 'Gateway', 'IPRange', 'Subnet'}
required_keys = {'Gateway', 'Subnet'}
observed_pairs = []
for config in configs:
    if type(config) is not dict:
        reject()
    keys = set(config)
    if not required_keys.issubset(keys) or not keys.issubset(allowed_keys):
        reject()
    subnet = config['Subnet']
    gateway = config['Gateway']
    if type(subnet) is not str or type(gateway) is not str:
        reject()
    if 'IPRange' in config:
        ip_range = config['IPRange']
        if ip_range is not None and (type(ip_range) is not str or ip_range != ''):
            reject()
    if 'AuxiliaryAddresses' in config:
        auxiliary = config['AuxiliaryAddresses']
        if auxiliary is not None and (type(auxiliary) is not dict or auxiliary):
            reject()
    observed_pairs.append((subnet, gateway))

expected_pairs = {
    (sys.argv[2], sys.argv[3]),
    (sys.argv[4], sys.argv[5]),
}
if len(expected_pairs) != 2 or set(observed_pairs) != expected_pairs:
    reject()
PY
}

create_kemerbet_recheck_network() {
  local expected_internal expected_ipv4_gateway expected_ipv4_subnet expected_ipv6_gateway
  local expected_ipv6_subnet expected_label expected_options network_id network_name observed_options
  local -a create_arguments=()
  for network_name in \
    "$KEMERBET_RECHECK_CONTROL_NETWORK" \
    "$KEMERBET_RECHECK_PROXY_NETWORK" \
    "$KEMERBET_RECHECK_EGRESS_NETWORK"; do
    case "$network_name" in
      "$KEMERBET_RECHECK_CONTROL_NETWORK")
        expected_internal='true'
        expected_label='kemerbet_readiness_control'
        expected_options=$'com.docker.network.bridge.gateway_mode_ipv4=isolated\ncom.docker.network.bridge.gateway_mode_ipv6=isolated'
        expected_ipv4_subnet="$KEMERBET_RECHECK_CONTROL_IPV4_SUBNET"
        expected_ipv4_gateway="$KEMERBET_RECHECK_CONTROL_IPV4_GATEWAY"
        expected_ipv6_subnet="$KEMERBET_RECHECK_CONTROL_IPV6_SUBNET"
        expected_ipv6_gateway="$KEMERBET_RECHECK_CONTROL_IPV6_GATEWAY"
        ;;
      "$KEMERBET_RECHECK_PROXY_NETWORK")
        expected_internal='true'
        expected_label='kemerbet_readiness_proxy'
        expected_options=$'com.docker.network.bridge.gateway_mode_ipv4=isolated\ncom.docker.network.bridge.gateway_mode_ipv6=isolated'
        expected_ipv4_subnet="$KEMERBET_RECHECK_PROXY_IPV4_SUBNET"
        expected_ipv4_gateway="$KEMERBET_RECHECK_PROXY_IPV4_GATEWAY"
        expected_ipv6_subnet="$KEMERBET_RECHECK_PROXY_IPV6_SUBNET"
        expected_ipv6_gateway="$KEMERBET_RECHECK_PROXY_IPV6_GATEWAY"
        ;;
      "$KEMERBET_RECHECK_EGRESS_NETWORK")
        expected_internal='false'
        expected_label='kemerbet_readiness_egress'
        expected_options=''
        expected_ipv4_subnet=''
        expected_ipv4_gateway=''
        expected_ipv6_subnet=''
        expected_ipv6_gateway=''
        ;;
      *) return 1 ;;
    esac
    network_id="$(docker_local network ls --quiet --filter "name=^${network_name}$")" || return 1
    [[ -z "$network_id" ]] || return 1
    create_arguments=(
      network create
      --driver bridge
      --ipv6
      --label "com.docker.compose.project=$PROJECT_NAME"
      --label "com.docker.compose.network=$expected_label"
    )
    if [[ "$expected_internal" == 'true' ]]; then
      create_arguments+=(
        --internal
        --opt 'com.docker.network.bridge.gateway_mode_ipv4=isolated'
        --opt 'com.docker.network.bridge.gateway_mode_ipv6=isolated'
      )
      if [[ "$network_name" == "$KEMERBET_RECHECK_CONTROL_NETWORK" ]]; then
        create_arguments+=(
          --subnet "$KEMERBET_RECHECK_CONTROL_IPV4_SUBNET"
          --gateway "$KEMERBET_RECHECK_CONTROL_IPV4_GATEWAY"
          --subnet "$KEMERBET_RECHECK_CONTROL_IPV6_SUBNET"
          --gateway "$KEMERBET_RECHECK_CONTROL_IPV6_GATEWAY"
        )
      else
        create_arguments+=(
          --subnet "$KEMERBET_RECHECK_PROXY_IPV4_SUBNET"
          --gateway "$KEMERBET_RECHECK_PROXY_IPV4_GATEWAY"
          --subnet "$KEMERBET_RECHECK_PROXY_IPV6_SUBNET"
          --gateway "$KEMERBET_RECHECK_PROXY_IPV6_GATEWAY"
        )
      fi
    fi
    create_arguments+=("$network_name")
    network_id="$(docker_local "${create_arguments[@]}")" || return 1
    [[ "$network_id" =~ ^[0-9a-f]{12,64}$ ]] || return 1
    [[ "$(docker_local network inspect "$network_id" \
      --format '{{.Name}}|{{.Driver}}|{{.Internal}}|{{.Attachable}}|{{.EnableIPv6}}|{{ index .Labels "com.docker.compose.project" }}|{{ index .Labels "com.docker.compose.network" }}')" == \
      "$network_name|bridge|$expected_internal|false|true|$PROJECT_NAME|$expected_label" ]] ||
      return 1
    observed_options="$(docker_local network inspect "$network_id" \
      --format '{{range $key, $value := .Options}}{{printf "%s=%s\n" $key $value}}{{end}}' | \
      LC_ALL=C sed '/^$/d' | \
      LC_ALL=C sort)" ||
      return 1
    [[ "$observed_options" == "$expected_options" ]] || return 1
    if [[ -n "$expected_ipv4_subnet" ]]; then
      require_kemerbet_recheck_network_ipam_contract \
        "$network_id" \
        "$expected_ipv4_subnet" "$expected_ipv4_gateway" \
        "$expected_ipv6_subnet" "$expected_ipv6_gateway" || return 1
    fi
    [[ -z "$(docker_local network inspect "$network_id" \
      --format '{{range $id, $_ := .Containers}}{{println $id}}{{end}}')" ]] || return 1
  done
}

kemerbet_recheck_network_identity() {
  local control_id proxy_id egress_id
  control_id="$(docker_local network inspect "$KEMERBET_RECHECK_CONTROL_NETWORK" --format '{{.Id}}')" ||
    return 1
  proxy_id="$(docker_local network inspect "$KEMERBET_RECHECK_PROXY_NETWORK" --format '{{.Id}}')" ||
    return 1
  egress_id="$(docker_local network inspect "$KEMERBET_RECHECK_EGRESS_NETWORK" --format '{{.Id}}')" ||
    return 1
  [[ "$control_id" =~ ^[0-9a-f]{64}$ && "$proxy_id" =~ ^[0-9a-f]{64}$ &&
    "$egress_id" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s|%s|%s' "$control_id" "$proxy_id" "$egress_id"
}

require_kemerbet_recheck_runtime_file() {
  local path="$1" metadata="$2"
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%u:%g:%a:%h:%s' "$path")" == "$metadata" ]]
}

require_kemerbet_recheck_agent_identity_source_contract() {
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$KEMERBET_RECHECK_CANDIDATE_BINDING" "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" <<'PY'
import os
import re
import stat
import sys


def reject():
    raise SystemExit(1)


def read_exact(path, expected_mode, expected_size=None):
    before = os.stat(path, follow_symlinks=False)
    if (
        not stat.S_ISREG(before.st_mode)
        or stat.S_ISLNK(before.st_mode)
        or before.st_uid != 0
        or before.st_gid != 0
        or stat.S_IMODE(before.st_mode) != expected_mode
        or before.st_nlink != 1
        or (expected_size is not None and before.st_size != expected_size)
        or os.path.realpath(path) != path
    ):
        reject()
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        opened = os.fstat(descriptor)
        identity = lambda value: (
            value.st_dev,
            value.st_ino,
            value.st_uid,
            value.st_gid,
            value.st_mode,
            value.st_nlink,
            value.st_size,
            value.st_mtime_ns,
        )
        if identity(opened) != identity(before):
            reject()
        data = bytearray()
        while True:
            chunk = os.read(descriptor, 4096)
            if not chunk:
                break
            data.extend(chunk)
            if len(data) > 4096:
                reject()
        after = os.fstat(descriptor)
        path_after = os.stat(path, follow_symlinks=False)
        if (
            identity(after) != identity(opened)
            or identity(path_after) != identity(after)
            or len(data) != after.st_size
        ):
            reject()
        return bytes(data)
    finally:
        os.close(descriptor)


try:
    if len(sys.argv) != 3:
        reject()
    binding = read_exact(sys.argv[1], 0o444, 230)
    key = read_exact(sys.argv[2], 0o444, 64)
    if not re.fullmatch(
        rb'[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12} '
        rb'hmac-sha256-agent-identity-v1:([0-9a-f]{64}) '
        rb'hmac-sha256-agent-profile-pin-v3:\1\n',
        binding,
    ):
        reject()
    if not re.fullmatch(rb'[0-9a-f]{64}', key):
        reject()
except SystemExit:
    raise
except Exception:
    reject()
PY
}

require_kemerbet_recheck_authorizations_contract() {
  local expected_nonce index mac nonce sequence token version
  local -a tokens=()
  require_kemerbet_recheck_runtime_file "$KEMERBET_RECHECK_AUTHORIZATIONS" \
    '10002:10002:400:1:515' || return 1
  mapfile -t tokens <"$KEMERBET_RECHECK_AUTHORIZATIONS" || return 1
  [[ "${#tokens[@]}" -eq 5 ]] || return 1
  expected_nonce="$(<"$KEMERBET_RECHECK_PROXY_RUN_NONCE")" || return 1
  [[ "$expected_nonce" =~ ^[0-9a-f]{32}$ ]] || return 1
  for index in 0 1 2 3 4; do
    token="${tokens[$index]}"
    IFS='.' read -r version nonce sequence mac <<<"$token"
    [[ "$version" == 'v1' && "$nonce" == "$expected_nonce" &&
      "$sequence" == "$((index + 1))" && "$mac" =~ ^[0-9a-f]{64}$ &&
      "$token" == "v1.$nonce.$sequence.$mac" ]] || return 1
  done
  env -i PATH="$SAFE_PATH" python3 - \
    "$KEMERBET_RECHECK_AUTHORIZATIONS" "$KEMERBET_RECHECK_AUTHORIZER_PLAYER_IDS" \
    "$KEMERBET_RECHECK_AUTHORIZER_HMAC_KEY" "$KEMERBET_RECHECK_AUTHORIZER_RUN_NONCE" <<'PY'
import hashlib
import hmac
import re
import sys

def reject():
    raise SystemExit(1)

try:
    token_path, player_path, key_path, nonce_path = sys.argv[1:]
    tokens = open(token_path, encoding='ascii', newline='').read().splitlines()
    players = open(player_path, encoding='ascii', newline='').read().splitlines()
    key = bytes.fromhex(open(key_path, encoding='ascii', newline='').read().removesuffix('\n'))
    nonce = open(nonce_path, encoding='ascii', newline='').read().removesuffix('\n')
    if len(tokens) != 5 or len(players) != 5 or len(set(players)) != 5 or len(key) != 32:
        reject()
    if not re.fullmatch(r'[0-9a-f]{32}', nonce):
        reject()
    for index, (token, player_id) in enumerate(zip(tokens, players), 1):
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}', player_id):
            reject()
        path = f'/Player/GeneralInfoByExternalId?externalId={player_id}'
        canonical = f'fetanagent-kemerbet-readiness-proxy-v1\n{nonce}\n{index}\nGET\nadmin-api.agt-digi.com\n{path}'
        mac = hmac.new(key, canonical.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(token, f'v1.{nonce}.{index}.{mac}'):
            reject()
except SystemExit:
    raise
except Exception:
    reject()
PY
}

require_kemerbet_recheck_profile_manifest_contract() {
  local account_id="$1"
  [[ "$account_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] ||
    return 1
  [[ ! -L "$KEMERBET_RECHECK_PROFILE_MANIFEST" &&
    -f "$KEMERBET_RECHECK_PROFILE_MANIFEST" &&
    "$(realpath -- "$KEMERBET_RECHECK_PROFILE_MANIFEST")" == "$KEMERBET_RECHECK_PROFILE_MANIFEST" &&
    "$(stat --format='%u:%g:%a:%h' "$KEMERBET_RECHECK_PROFILE_MANIFEST")" == '0:0:400:1' ]] ||
    return 1
  env -i PATH="$SAFE_PATH" python3 - "$KEMERBET_RECHECK_PROFILE_MANIFEST" "$account_id" <<'PY'
import hashlib
import json
import os
import stat
import sys

def reject():
    raise SystemExit(1)

path, account_id = sys.argv[1:]

def identity(value):
    return (
        value.st_dev,
        value.st_ino,
        value.st_uid,
        value.st_gid,
        value.st_mode,
        value.st_nlink,
        value.st_size,
        value.st_mtime_ns,
    )

try:
    before = os.stat(path, follow_symlinks=False)
    if (
        not stat.S_ISREG(before.st_mode)
        or stat.S_ISLNK(before.st_mode)
        or before.st_uid != 0
        or before.st_gid != 0
        or stat.S_IMODE(before.st_mode) != 0o400
        or before.st_nlink != 1
        or before.st_size < 1
        or before.st_size > 1024
        or os.path.realpath(path) != path
    ):
        reject()
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        opened = os.fstat(descriptor)
        if identity(opened) != identity(before):
            reject()
        content = bytearray()
        while True:
            chunk = os.read(descriptor, 1024)
            if not chunk:
                break
            content.extend(chunk)
            if len(content) > 1024:
                reject()
        opened_after = os.fstat(descriptor)
        path_after = os.stat(path, follow_symlinks=False)
        if (
            identity(opened_after) != identity(opened)
            or identity(path_after) != identity(opened_after)
            or len(content) != opened_after.st_size
        ):
            reject()
        data = bytes(content)
    finally:
        os.close(descriptor)
except SystemExit:
    raise
except Exception:
    reject()

if not data.endswith(b'\n') or b'\r' in data or b'\0' in data or len(data) > 1024:
    reject()
try:
    value = json.loads(data[:-1].decode('utf-8'))
except Exception:
    reject()
keys = ['accountIdSha256', 'contract', 'directoryCount', 'fileCount', 'treeSha256', 'version']
if not isinstance(value, dict) or sorted(value) != sorted(keys):
    reject()
if value.get('contract') != 'fetanagent-kemerbet-readiness-profile-snapshot-v1' or value.get('version') != 1:
    reject()
if value.get('accountIdSha256') != hashlib.sha256(account_id.encode()).hexdigest():
    reject()
tree = value.get('treeSha256')
directories = value.get('directoryCount')
files = value.get('fileCount')
if not isinstance(tree, str) or len(tree) != 64 or any(c not in '0123456789abcdef' for c in tree):
    reject()
if type(directories) is not int or directories < 1 or type(files) is not int or files < 0:
    reject()
if directories + files > 200000:
    reject()
canonical = json.dumps({
    'accountIdSha256': value['accountIdSha256'],
    'contract': value['contract'],
    'directoryCount': directories,
    'fileCount': files,
    'treeSha256': tree,
    'version': 1,
}, separators=(',', ':'), ensure_ascii=False).encode() + b'\n'
if data != canonical:
    reject()
PY
}

require_kemerbet_recheck_completion_receipt_contract() {
  local commit_sha="$1"
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || return 1
  [[ ! -L "$KEMERBET_RECHECK_PROXY_COMPLETION_RECEIPT" &&
    -f "$KEMERBET_RECHECK_PROXY_COMPLETION_RECEIPT" &&
    "$(realpath -- "$KEMERBET_RECHECK_PROXY_COMPLETION_RECEIPT")" == \
      "$KEMERBET_RECHECK_PROXY_COMPLETION_RECEIPT" &&
    "$(stat --format='%u:%g:%a:%h' "$KEMERBET_RECHECK_PROXY_COMPLETION_RECEIPT")" == \
      '10003:10003:400:1' ]] || return 1
  env -i PATH="$SAFE_PATH" python3 - \
    "$KEMERBET_RECHECK_PROXY_COMPLETION_RECEIPT" \
    "$KEMERBET_RECHECK_PROXY_RUN_NONCE" \
    "$KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_BINDINGS" "$commit_sha" <<'PY'
import hashlib
import json
import os
import stat
import sys

def reject():
    raise SystemExit(1)

try:
    receipt_path, nonce_path, binding_path, release_sha = sys.argv[1:]

    def read_exact(path, uid, gid, mode, maximum, expected_size=None):
        before = os.stat(path, follow_symlinks=False)
        if (
            not stat.S_ISREG(before.st_mode)
            or stat.S_ISLNK(before.st_mode)
            or before.st_uid != uid
            or before.st_gid != gid
            or stat.S_IMODE(before.st_mode) != mode
            or before.st_nlink != 1
            or before.st_size < 1
            or before.st_size > maximum
            or (expected_size is not None and before.st_size != expected_size)
            or os.path.realpath(path) != path
        ):
            reject()
        descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
        try:
            opened = os.fstat(descriptor)
            identity = lambda value: (
                value.st_dev,
                value.st_ino,
                value.st_uid,
                value.st_gid,
                value.st_mode,
                value.st_nlink,
                value.st_size,
                value.st_mtime_ns,
            )
            if identity(opened) != identity(before):
                reject()
            data = bytearray()
            while True:
                chunk = os.read(descriptor, 4096)
                if not chunk:
                    break
                data.extend(chunk)
                if len(data) > maximum:
                    reject()
            opened_after = os.fstat(descriptor)
            path_after = os.stat(path, follow_symlinks=False)
            if (
                identity(opened_after) != identity(opened)
                or identity(path_after) != identity(opened_after)
                or len(data) != opened_after.st_size
            ):
                reject()
            return bytes(data)
        finally:
            os.close(descriptor)

    data = read_exact(receipt_path, 10003, 10003, 0o400, 1024)
    nonce_serialized = read_exact(nonce_path, 10003, 10003, 0o400, 33, 33)
    binding_serialized = read_exact(binding_path, 10003, 10003, 0o400, 230, 230)
    if not data.endswith(b'\n') or b'\r' in data or b'\0' in data:
        reject()
    if nonce_serialized[-1:] != b'\n':
        reject()
    nonce = bytes.fromhex(nonce_serialized[:-1].decode('ascii'))
    if len(nonce) != 16:
        reject()
except Exception:
    reject()
expected = {
    'contract': 'fetanagent-kemerbet-readiness-layer7-completion-v3',
    'agentIdentityBindingSha256': hashlib.sha256(binding_serialized).hexdigest(),
    'identifiersRedacted': True,
    'moneyMoved': False,
    'releaseSha': release_sha,
    'responsesValidated': True,
    'runNonceSha256': hashlib.sha256(nonce).hexdigest(),
    'sameAgentIdentityValidated': True,
    'stableAgentProfileValidated': True,
    'sequences': [1, 2, 3, 4, 5],
    'transferDisabled': True,
    'version': 3,
}
canonical = json.dumps(expected, separators=(',', ':'), ensure_ascii=False).encode() + b'\n'
if data != canonical:
    reject()
PY
}

read_kemerbet_recheck_fixed_stage() {
  local role="$1" output_root stage_file expected_uid
  case "$role" in
    controller)
      output_root="$KEMERBET_RECHECK_CONTROLLER_STAGE_OUTPUT_ROOT"
      stage_file="$KEMERBET_RECHECK_CONTROLLER_STAGE"
      expected_uid='10002'
      ;;
    browser)
      output_root="$KEMERBET_RECHECK_BROWSER_STAGE_OUTPUT_ROOT"
      stage_file="$KEMERBET_RECHECK_BROWSER_STAGE"
      expected_uid='10001'
      ;;
    proxy)
      output_root="$KEMERBET_RECHECK_PROXY_STAGE_OUTPUT_ROOT"
      stage_file="$KEMERBET_RECHECK_PROXY_STAGE"
      expected_uid='10003'
      ;;
    *) return 1 ;;
  esac
  env -i PATH="$SAFE_PATH" python3 - "$role" "$output_root" "$stage_file" "$expected_uid" <<'PY'
import os
import stat
import sys

role, root, path, uid_serialized = sys.argv[1:]
uid = int(uid_serialized)
allowed = {
    'controller': {
        'controller_not_started', 'controller_bootstrap', 'controller_rpc_open',
        'controller_identity', 'controller_authorization', 'controller_lookup_1',
        'controller_lookup_2', 'controller_lookup_3', 'controller_lookup_4',
        'controller_lookup_5', 'controller_finalize', 'controller_cleanup',
        'controller_complete',
    },
    'browser': {
        'browser_not_started', 'browser_bootstrap', 'browser_rpc_listen', 'browser_open',
        'browser_restored_navigation', 'browser_refresh_admitted', 'browser_identity',
        'browser_probe_ready', 'browser_lookup_1', 'browser_lookup_2', 'browser_lookup_3',
        'browser_lookup_4', 'browser_lookup_5', 'browser_forbidden_request',
        'browser_finalize', 'browser_cleanup', 'browser_complete',
    },
    'proxy': {
        'proxy_not_started', 'proxy_bootstrap', 'proxy_ready',
        'browser_refresh_forwarded', 'browser_refresh_response_complete',
    },
}

def reject():
    raise SystemExit(1)

def identity(value):
    return (
        value.st_dev, value.st_ino, value.st_uid, value.st_gid, value.st_mode,
        value.st_nlink, value.st_size, value.st_mtime_ns,
    )

try:
    if role not in allowed or path != root + '/stage-v1':
        reject()
    root_stat = os.stat(root, follow_symlinks=False)
    entries = sorted(os.listdir(root))
    if (
        not stat.S_ISDIR(root_stat.st_mode)
        or stat.S_ISLNK(root_stat.st_mode)
        or root_stat.st_uid != uid
        or root_stat.st_gid != uid
        or stat.S_IMODE(root_stat.st_mode) != 0o700
        or os.path.realpath(root) != root
        or entries != ['stage-v1']
    ):
        reject()
    before = os.stat(path, follow_symlinks=False)
    if (
        not stat.S_ISREG(before.st_mode)
        or stat.S_ISLNK(before.st_mode)
        or before.st_uid != uid
        or before.st_gid != uid
        or stat.S_IMODE(before.st_mode) != 0o400
        or before.st_nlink != 1
        or before.st_size < 2
        or before.st_size > 64
        or os.path.realpath(path) != path
    ):
        reject()
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        opened = os.fstat(descriptor)
        if identity(opened) != identity(before):
            reject()
        data = os.read(descriptor, 65)
        if os.read(descriptor, 1) != b'':
            reject()
        opened_after = os.fstat(descriptor)
        path_after = os.stat(path, follow_symlinks=False)
        if identity(opened_after) != identity(opened) or identity(path_after) != identity(opened_after):
            reject()
    finally:
        os.close(descriptor)
    if len(data) != before.st_size or not data.endswith(b'\n') or b'\n' in data[:-1] or b'\r' in data or b'\0' in data:
        reject()
    root_after = os.stat(root, follow_symlinks=False)
    if identity(root_after) != identity(root_stat) or sorted(os.listdir(root)) != ['stage-v1']:
        reject()
    stage = data[:-1].decode('ascii')
    if stage not in allowed[role]:
        reject()
except SystemExit:
    raise
except Exception:
    reject()
print(stage)
PY
}

require_kemerbet_recheck_fixed_stage_contract() {
  local phase="$1" controller_stage browser_stage proxy_stage
  [[ "$phase" == 'prepared' || "$phase" == 'released' || "$phase" == 'completed' ]] || return 1
  controller_stage="$(read_kemerbet_recheck_fixed_stage controller)" || return 1
  browser_stage="$(read_kemerbet_recheck_fixed_stage browser)" || return 1
  proxy_stage="$(read_kemerbet_recheck_fixed_stage proxy)" || return 1
  case "$phase" in
    prepared)
      [[ "$controller_stage" == 'controller_not_started' &&
        "$browser_stage" == 'browser_not_started' &&
        "$proxy_stage" == 'proxy_not_started' ]]
      ;;
    released) return 0 ;;
    completed)
      [[ "$controller_stage" == 'controller_complete' &&
        "$browser_stage" == 'browser_complete' &&
        ( "$proxy_stage" == 'proxy_ready' ||
          "$proxy_stage" == 'browser_refresh_response_complete' ) ]]
      ;;
  esac
}

print_kemerbet_recheck_fixed_failure_stages() {
  local controller_stage browser_stage proxy_stage
  controller_stage="$(read_kemerbet_recheck_fixed_stage controller)" || return 1
  browser_stage="$(read_kemerbet_recheck_fixed_stage browser)" || return 1
  proxy_stage="$(read_kemerbet_recheck_fixed_stage proxy)" || return 1
  printf 'KemerBet readiness fixed controller stage: %s\n' "$controller_stage" >&2
  printf 'KemerBet readiness fixed browser stage: %s\n' "$browser_stage" >&2
  printf 'KemerBet readiness fixed proxy stage: %s\n' "$proxy_stage" >&2
}

require_kemerbet_recheck_runtime_artifacts() {
  local phase="$1" commit_sha="$2" account_id="$3" browser_digest controller_digest entry
  local authorizer_key_inode authorizer_nonce_inode proxy_key_inode proxy_nonce_inode
  local candidate_binding_inode identity_key_inode proxy_identity_binding_inode proxy_identity_key_inode
  local profile_entries proxy_entries
  [[ "$phase" == 'prepared' || "$phase" == 'released' || "$phase" == 'completed' ]] || return 1
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ &&
    "$account_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] || return 1
  [[ ! -L /run && -d /run && "$(realpath -- /run)" == '/run' &&
    "$(stat --format='%U:%G:%a' /run)" == 'root:root:755' ]] || return 1
  [[ ! -L "$KEMERBET_RECHECK_RPC_ROOT" && -d "$KEMERBET_RECHECK_RPC_ROOT" &&
    "$(realpath -- "$KEMERBET_RECHECK_RPC_ROOT")" == "$KEMERBET_RECHECK_RPC_ROOT" &&
    "$(stat --format='%U:%G:%a' "$KEMERBET_RECHECK_RPC_ROOT")" == 'root:root:700' ]] ||
    return 1
  while IFS= read -r entry; do
    case "$entry" in
      authorizer-hmac-key|authorizer-player-ids|authorizer-run-nonce|browser-account-id|\
browser-capability|browser-firewall-release|browser-stage-output|controller-capability|\
controller-firewall-release|controller-stage-output|layer7-authorizations|profile-output|\
proxy-agent-identity-bindings|proxy-agent-identity-hmac-key|proxy-hmac-key|proxy-output|\
proxy-run-nonce|proxy-stage-output|release-sha|snapshot-account-id) ;;
      *) return 1 ;;
    esac
  done < <(find -P "$KEMERBET_RECHECK_RPC_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)
  require_kemerbet_recheck_runtime_file "$KEMERBET_RECHECK_RPC_CONTROLLER_CAPABILITY" \
    '10002:10002:400:1:65' || return 1
  require_kemerbet_recheck_runtime_file "$KEMERBET_RECHECK_RPC_BROWSER_CAPABILITY" \
    '10001:10001:400:1:65' || return 1
  LC_ALL=C grep -Eq '^[0-9a-f]{64}$' "$KEMERBET_RECHECK_RPC_CONTROLLER_CAPABILITY" || return 1
  LC_ALL=C grep -Eq '^[0-9a-f]{64}$' "$KEMERBET_RECHECK_RPC_BROWSER_CAPABILITY" || return 1
  cmp -s -- "$KEMERBET_RECHECK_RPC_CONTROLLER_CAPABILITY" \
    "$KEMERBET_RECHECK_RPC_BROWSER_CAPABILITY" || return 1
  controller_digest="$(sha256sum -- "$KEMERBET_RECHECK_RPC_CONTROLLER_CAPABILITY" | awk '{print $1}')" ||
    return 1
  browser_digest="$(sha256sum -- "$KEMERBET_RECHECK_RPC_BROWSER_CAPABILITY" | awk '{print $1}')" ||
    return 1
  [[ "$controller_digest" =~ ^[0-9a-f]{64}$ && "$browser_digest" == "$controller_digest" ]] ||
    return 1
  require_kemerbet_recheck_runtime_file "$KEMERBET_RECHECK_AUTHORIZER_HMAC_KEY" \
    '10004:10004:400:1:65' || return 1
  require_kemerbet_recheck_runtime_file "$KEMERBET_RECHECK_AUTHORIZER_RUN_NONCE" \
    '10004:10004:400:1:33' || return 1
  require_kemerbet_recheck_runtime_file "$KEMERBET_RECHECK_PROXY_HMAC_KEY" \
    '10003:10003:400:1:65' || return 1
  require_kemerbet_recheck_runtime_file "$KEMERBET_RECHECK_PROXY_RUN_NONCE" \
    '10003:10003:400:1:33' || return 1
  LC_ALL=C grep -Eq '^[0-9a-f]{64}$' "$KEMERBET_RECHECK_AUTHORIZER_HMAC_KEY" || return 1
  LC_ALL=C grep -Eq '^[0-9a-f]{32}$' "$KEMERBET_RECHECK_AUTHORIZER_RUN_NONCE" || return 1
  cmp -s -- "$KEMERBET_RECHECK_AUTHORIZER_HMAC_KEY" "$KEMERBET_RECHECK_PROXY_HMAC_KEY" ||
    return 1
  cmp -s -- "$KEMERBET_RECHECK_AUTHORIZER_RUN_NONCE" "$KEMERBET_RECHECK_PROXY_RUN_NONCE" ||
    return 1
  authorizer_key_inode="$(stat --format='%d:%i' "$KEMERBET_RECHECK_AUTHORIZER_HMAC_KEY")" ||
    return 1
  proxy_key_inode="$(stat --format='%d:%i' "$KEMERBET_RECHECK_PROXY_HMAC_KEY")" || return 1
  authorizer_nonce_inode="$(stat --format='%d:%i' "$KEMERBET_RECHECK_AUTHORIZER_RUN_NONCE")" ||
    return 1
  proxy_nonce_inode="$(stat --format='%d:%i' "$KEMERBET_RECHECK_PROXY_RUN_NONCE")" || return 1
  [[ "$authorizer_key_inode" != "$proxy_key_inode" &&
    "$authorizer_nonce_inode" != "$proxy_nonce_inode" ]] || return 1
  require_kemerbet_recheck_agent_identity_source_contract || return 1
  require_kemerbet_recheck_runtime_file "$KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_BINDINGS" \
    '10003:10003:400:1:230' || return 1
  require_kemerbet_recheck_runtime_file "$KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_HMAC_KEY" \
    '10003:10003:400:1:64' || return 1
  cmp -s -- "$KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_BINDINGS" \
    "$KEMERBET_RECHECK_CANDIDATE_BINDING" || return 1
  cmp -s -- "$KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_HMAC_KEY" \
    "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" || return 1
  LC_ALL=C grep -Eq '^[0-9a-f]{64}$' "$KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_HMAC_KEY" ||
    return 1
  candidate_binding_inode="$(stat --format='%d:%i' "$KEMERBET_RECHECK_CANDIDATE_BINDING")" ||
    return 1
  identity_key_inode="$(stat --format='%d:%i' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")" || return 1
  proxy_identity_binding_inode="$(stat --format='%d:%i' \
    "$KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_BINDINGS")" || return 1
  proxy_identity_key_inode="$(stat --format='%d:%i' \
    "$KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_HMAC_KEY")" || return 1
  [[ "$proxy_identity_binding_inode" != "$candidate_binding_inode" &&
    "$proxy_identity_key_inode" != "$identity_key_inode" &&
    "$proxy_identity_key_inode" != "$proxy_key_inode" ]] || return 1
  require_kemerbet_recheck_runtime_file "$KEMERBET_RECHECK_AUTHORIZER_PLAYER_IDS" \
    "0:0:444:1:$(stat --format='%s' "$KEMERBET_READINESS_PLAYER_IDS")" || return 1
  cmp -s -- "$KEMERBET_RECHECK_AUTHORIZER_PLAYER_IDS" "$KEMERBET_READINESS_PLAYER_IDS" ||
    return 1
  require_kemerbet_recheck_runtime_file "$KEMERBET_RECHECK_BROWSER_ACCOUNT_ID" \
    '10001:10001:400:1:37' || return 1
  require_kemerbet_recheck_runtime_file "$KEMERBET_RECHECK_SNAPSHOT_ACCOUNT_ID" \
    '0:0:400:1:37' || return 1
  LC_ALL=C grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' \
    "$KEMERBET_RECHECK_BROWSER_ACCOUNT_ID" || return 1
  cmp -s -- "$KEMERBET_RECHECK_BROWSER_ACCOUNT_ID" "$KEMERBET_RECHECK_SNAPSHOT_ACCOUNT_ID" ||
    return 1
  require_kemerbet_recheck_runtime_file "$KEMERBET_RECHECK_RELEASE_SHA" \
    '10003:10003:400:1:41' || return 1
  [[ "$(<"$KEMERBET_RECHECK_RELEASE_SHA")" == "$commit_sha" ]] || return 1
  require_kemerbet_recheck_authorizations_contract || return 1
  [[ ! -L "$KEMERBET_RECHECK_PROFILE_OUTPUT_ROOT" &&
    -d "$KEMERBET_RECHECK_PROFILE_OUTPUT_ROOT" &&
    "$(realpath -- "$KEMERBET_RECHECK_PROFILE_OUTPUT_ROOT")" == \
      "$KEMERBET_RECHECK_PROFILE_OUTPUT_ROOT" &&
    "$(stat --format='%u:%g:%a' "$KEMERBET_RECHECK_PROFILE_OUTPUT_ROOT")" == '0:0:700' ]] ||
    return 1
  [[ ! -L "$KEMERBET_RECHECK_PROXY_OUTPUT_ROOT" &&
    -d "$KEMERBET_RECHECK_PROXY_OUTPUT_ROOT" &&
    "$(realpath -- "$KEMERBET_RECHECK_PROXY_OUTPUT_ROOT")" == "$KEMERBET_RECHECK_PROXY_OUTPUT_ROOT" &&
    "$(stat --format='%u:%g:%a' "$KEMERBET_RECHECK_PROXY_OUTPUT_ROOT")" == '10003:10003:700' ]] ||
    return 1
  profile_entries="$(find -P "$KEMERBET_RECHECK_PROFILE_OUTPUT_ROOT" \
    -mindepth 1 -maxdepth 1 -printf '%f\n')" || return 1
  [[ "$profile_entries" == 'profile-manifest' ]] || return 1
  require_kemerbet_recheck_profile_manifest_contract "$account_id" || return 1
  require_kemerbet_recheck_fixed_stage_contract "$phase" || return 1
  case "$phase" in
    prepared)
      require_kemerbet_recheck_runtime_file "$KEMERBET_RECHECK_CONTROLLER_FIREWALL_RELEASE" \
        '0:0:444:1:0' || return 1
      require_kemerbet_recheck_runtime_file "$KEMERBET_RECHECK_BROWSER_FIREWALL_RELEASE" \
        '0:0:444:1:0' || return 1
      [[ ! -e "$KEMERBET_RECHECK_PROXY_COMPLETION_RECEIPT" &&
        ! -L "$KEMERBET_RECHECK_PROXY_COMPLETION_RECEIPT" ]] || return 1
      ;;
    released|completed)
      require_kemerbet_recheck_runtime_file "$KEMERBET_RECHECK_CONTROLLER_FIREWALL_RELEASE" \
        "0:0:444:1:$(( ${#KEMERBET_RECHECK_FIREWALL_RELEASE_CONTENT} + 1 ))" || return 1
      require_kemerbet_recheck_runtime_file "$KEMERBET_RECHECK_BROWSER_FIREWALL_RELEASE" \
        "0:0:444:1:$(( ${#KEMERBET_RECHECK_FIREWALL_RELEASE_CONTENT} + 1 ))" || return 1
      [[ "$(<"$KEMERBET_RECHECK_CONTROLLER_FIREWALL_RELEASE")" == \
        "$KEMERBET_RECHECK_FIREWALL_RELEASE_CONTENT" &&
        "$(<"$KEMERBET_RECHECK_BROWSER_FIREWALL_RELEASE")" == \
        "$KEMERBET_RECHECK_FIREWALL_RELEASE_CONTENT" ]] || return 1
      ;;
  esac
  if [[ "$phase" == 'completed' ]]; then
    proxy_entries="$(find -P "$KEMERBET_RECHECK_PROXY_OUTPUT_ROOT" \
      -mindepth 1 -maxdepth 1 -printf '%f\n')" || return 1
    [[ "$proxy_entries" == 'completion-receipt' ]] || return 1
    require_kemerbet_recheck_completion_receipt_contract "$commit_sha" || return 1
  else
    proxy_entries="$(find -P "$KEMERBET_RECHECK_PROXY_OUTPUT_ROOT" \
      -mindepth 1 -maxdepth 1 -printf '%f\n')" || return 1
    [[ -z "$proxy_entries" && ! -e "$KEMERBET_RECHECK_PROXY_COMPLETION_RECEIPT" &&
      ! -L "$KEMERBET_RECHECK_PROXY_COMPLETION_RECEIPT" ]] || return 1
  fi
}

remove_kemerbet_recheck_rpc_capabilities() {
  local entry
  if [[ ! -e "$KEMERBET_RECHECK_RPC_ROOT" && ! -L "$KEMERBET_RECHECK_RPC_ROOT" ]]; then
    return 0
  fi
  [[ ! -L "$KEMERBET_RECHECK_RPC_ROOT" && -d "$KEMERBET_RECHECK_RPC_ROOT" &&
    "$(realpath -- "$KEMERBET_RECHECK_RPC_ROOT")" == "$KEMERBET_RECHECK_RPC_ROOT" &&
    "$(stat --format='%U:%G:%a' "$KEMERBET_RECHECK_RPC_ROOT")" == 'root:root:700' ]] ||
    return 1
  while IFS= read -r entry; do
    case "$entry" in
      .account-id.installing|.capability.installing|.proxy-hmac-key.installing|\
.proxy-run-nonce.installing|.release-sha.installing|authorizer-hmac-key|authorizer-player-ids|\
  authorizer-run-nonce|browser-account-id|browser-capability|browser-firewall-release|\
  browser-stage-output|controller-capability|controller-firewall-release|controller-stage-output|\
  layer7-authorizations|profile-output|proxy-agent-identity-bindings|\
  proxy-agent-identity-hmac-key|proxy-hmac-key|proxy-output|proxy-run-nonce|proxy-stage-output|\
  release-sha|snapshot-account-id|authorizer-output) ;;
      *) return 1 ;;
    esac
  done < <(find -P "$KEMERBET_RECHECK_RPC_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)
  for directory in \
    "$KEMERBET_RECHECK_AUTHORIZER_OUTPUT_ROOT" \
    "$KEMERBET_RECHECK_CONTROLLER_STAGE_OUTPUT_ROOT" \
    "$KEMERBET_RECHECK_BROWSER_STAGE_OUTPUT_ROOT" \
    "$KEMERBET_RECHECK_PROXY_STAGE_OUTPUT_ROOT" \
    "$KEMERBET_RECHECK_PROXY_OUTPUT_ROOT" \
    "$KEMERBET_RECHECK_PROFILE_OUTPUT_ROOT"; do
    if [[ -e "$directory" || -L "$directory" ]]; then
      [[ ! -L "$directory" && -d "$directory" ]] || return 1
      while IFS= read -r entry; do
        case "$entry" in
          .authorizations.installing|authorizations|.completion-receipt.installing|\
completion-receipt|.profile-manifest.installing|profile-manifest|stage-v1|stage-v1.installing) ;;
          *) return 1 ;;
        esac
        [[ ! -L "$directory/$entry" && -f "$directory/$entry" ]] || return 1
        rm -f -- "$directory/$entry" || return 1
      done < <(find -P "$directory" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)
      rmdir -- "$directory" || return 1
    fi
  done
  rm -f -- \
    "$KEMERBET_RECHECK_RPC_INSTALLING" \
    "$KEMERBET_RECHECK_PROXY_HMAC_INSTALLING" \
    "$KEMERBET_RECHECK_PROXY_NONCE_INSTALLING" \
    "$KEMERBET_RECHECK_RPC_ROOT/.account-id.installing" \
    "$KEMERBET_RECHECK_RPC_ROOT/.release-sha.installing" \
    "$KEMERBET_RECHECK_RPC_CONTROLLER_CAPABILITY" \
    "$KEMERBET_RECHECK_RPC_BROWSER_CAPABILITY" \
    "$KEMERBET_RECHECK_AUTHORIZER_HMAC_KEY" \
    "$KEMERBET_RECHECK_AUTHORIZER_RUN_NONCE" \
    "$KEMERBET_RECHECK_AUTHORIZER_PLAYER_IDS" \
    "$KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_BINDINGS" \
    "$KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_HMAC_KEY" \
    "$KEMERBET_RECHECK_PROXY_HMAC_KEY" \
    "$KEMERBET_RECHECK_PROXY_RUN_NONCE" \
    "$KEMERBET_RECHECK_AUTHORIZATIONS" \
    "$KEMERBET_RECHECK_BROWSER_ACCOUNT_ID" \
    "$KEMERBET_RECHECK_SNAPSHOT_ACCOUNT_ID" \
    "$KEMERBET_RECHECK_RELEASE_SHA" \
    "$KEMERBET_RECHECK_CONTROLLER_FIREWALL_RELEASE" \
    "$KEMERBET_RECHECK_BROWSER_FIREWALL_RELEASE" || return 1
  rmdir -- "$KEMERBET_RECHECK_RPC_ROOT" >/dev/null 2>&1 || return 1
  sync -f /run >/dev/null 2>&1 || return 1
  [[ ! -e "$KEMERBET_RECHECK_RPC_ROOT" && ! -L "$KEMERBET_RECHECK_RPC_ROOT" ]]
}

create_kemerbet_recheck_rpc_capabilities() {
  local account_id="$1" commit_sha="$2" candidate_binding_inode identity_key_inode
  local proxy_identity_binding_inode proxy_identity_key_inode
  command -v openssl >/dev/null 2>&1 || return 1
  command -v python3 >/dev/null 2>&1 || return 1
  [[ "$account_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ &&
    "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || return 1
  [[ ! -L /run && -d /run && "$(realpath -- /run)" == '/run' &&
    "$(stat --format='%U:%G:%a' /run)" == 'root:root:755' ]] || return 1
  [[ ! -e "$KEMERBET_RECHECK_RPC_ROOT" && ! -L "$KEMERBET_RECHECK_RPC_ROOT" ]] || return 1
  require_kemerbet_recheck_agent_identity_source_contract || return 1
  install -d -o root -g root -m 0700 "$KEMERBET_RECHECK_RPC_ROOT" || return 1
  (umask 077 && openssl rand -hex 32 >"$KEMERBET_RECHECK_RPC_INSTALLING") || return 1
  (umask 077 && openssl rand -hex 32 >"$KEMERBET_RECHECK_PROXY_HMAC_INSTALLING") || return 1
  (umask 077 && openssl rand -hex 16 >"$KEMERBET_RECHECK_PROXY_NONCE_INSTALLING") || return 1
  LC_ALL=C grep -Eq '^[0-9a-f]{64}$' "$KEMERBET_RECHECK_RPC_INSTALLING" || return 1
  LC_ALL=C grep -Eq '^[0-9a-f]{64}$' "$KEMERBET_RECHECK_PROXY_HMAC_INSTALLING" || return 1
  LC_ALL=C grep -Eq '^[0-9a-f]{32}$' "$KEMERBET_RECHECK_PROXY_NONCE_INSTALLING" || return 1
  install -o 10002 -g 10002 -m 0400 -T -- "$KEMERBET_RECHECK_RPC_INSTALLING" \
    "$KEMERBET_RECHECK_RPC_CONTROLLER_CAPABILITY" || return 1
  install -o 10001 -g 10001 -m 0400 -T -- "$KEMERBET_RECHECK_RPC_INSTALLING" \
    "$KEMERBET_RECHECK_RPC_BROWSER_CAPABILITY" || return 1
  install -o 10004 -g 10004 -m 0400 -T -- "$KEMERBET_RECHECK_PROXY_HMAC_INSTALLING" \
    "$KEMERBET_RECHECK_AUTHORIZER_HMAC_KEY" || return 1
  install -o 10003 -g 10003 -m 0400 -T -- "$KEMERBET_RECHECK_PROXY_HMAC_INSTALLING" \
    "$KEMERBET_RECHECK_PROXY_HMAC_KEY" || return 1
  install -o 10004 -g 10004 -m 0400 -T -- "$KEMERBET_RECHECK_PROXY_NONCE_INSTALLING" \
    "$KEMERBET_RECHECK_AUTHORIZER_RUN_NONCE" || return 1
  install -o 10003 -g 10003 -m 0400 -T -- "$KEMERBET_RECHECK_PROXY_NONCE_INSTALLING" \
    "$KEMERBET_RECHECK_PROXY_RUN_NONCE" || return 1
  install -o 10003 -g 10003 -m 0400 -T -- "$KEMERBET_RECHECK_CANDIDATE_BINDING" \
    "$KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_BINDINGS" || return 1
  install -o 10003 -g 10003 -m 0400 -T -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" \
    "$KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_HMAC_KEY" || return 1
  sync -f "$KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_BINDINGS" || return 1
  sync -f "$KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_HMAC_KEY" || return 1
  require_kemerbet_recheck_runtime_file "$KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_BINDINGS" \
    '10003:10003:400:1:230' || return 1
  require_kemerbet_recheck_runtime_file "$KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_HMAC_KEY" \
    '10003:10003:400:1:64' || return 1
  cmp -s -- "$KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_BINDINGS" \
    "$KEMERBET_RECHECK_CANDIDATE_BINDING" || return 1
  cmp -s -- "$KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_HMAC_KEY" \
    "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" || return 1
  candidate_binding_inode="$(stat --format='%d:%i' "$KEMERBET_RECHECK_CANDIDATE_BINDING")" ||
    return 1
  identity_key_inode="$(stat --format='%d:%i' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")" || return 1
  proxy_identity_binding_inode="$(stat --format='%d:%i' \
    "$KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_BINDINGS")" || return 1
  proxy_identity_key_inode="$(stat --format='%d:%i' \
    "$KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_HMAC_KEY")" || return 1
  [[ "$proxy_identity_binding_inode" != "$candidate_binding_inode" &&
    "$proxy_identity_key_inode" != "$identity_key_inode" ]] || return 1
  install -o root -g root -m 0444 -T -- "$KEMERBET_READINESS_PLAYER_IDS" \
    "$KEMERBET_RECHECK_AUTHORIZER_PLAYER_IDS" || return 1
  (umask 077 && printf '%s\n' "$account_id" >"$KEMERBET_RECHECK_RPC_ROOT/.account-id.installing") ||
    return 1
  install -o 10001 -g 10001 -m 0400 -T -- "$KEMERBET_RECHECK_RPC_ROOT/.account-id.installing" \
    "$KEMERBET_RECHECK_BROWSER_ACCOUNT_ID" || return 1
  install -o root -g root -m 0400 -T -- "$KEMERBET_RECHECK_RPC_ROOT/.account-id.installing" \
    "$KEMERBET_RECHECK_SNAPSHOT_ACCOUNT_ID" || return 1
  (umask 077 && printf '%s\n' "$commit_sha" >"$KEMERBET_RECHECK_RPC_ROOT/.release-sha.installing") ||
    return 1
  install -o 10003 -g 10003 -m 0400 -T -- "$KEMERBET_RECHECK_RPC_ROOT/.release-sha.installing" \
    "$KEMERBET_RECHECK_RELEASE_SHA" || return 1
  install -o root -g root -m 0444 /dev/null "$KEMERBET_RECHECK_CONTROLLER_FIREWALL_RELEASE" ||
    return 1
  install -o root -g root -m 0444 /dev/null "$KEMERBET_RECHECK_BROWSER_FIREWALL_RELEASE" ||
    return 1
  install -d -o 10004 -g 10004 -m 0700 "$KEMERBET_RECHECK_AUTHORIZER_OUTPUT_ROOT" ||
    return 1
  install -d -o 10003 -g 10003 -m 0700 "$KEMERBET_RECHECK_PROXY_OUTPUT_ROOT" || return 1
  install -d -o root -g root -m 0700 "$KEMERBET_RECHECK_PROFILE_OUTPUT_ROOT" || return 1
  install -d -o 10002 -g 10002 -m 0700 "$KEMERBET_RECHECK_CONTROLLER_STAGE_OUTPUT_ROOT" ||
    return 1
  install -d -o 10001 -g 10001 -m 0700 "$KEMERBET_RECHECK_BROWSER_STAGE_OUTPUT_ROOT" ||
    return 1
  install -d -o 10003 -g 10003 -m 0700 "$KEMERBET_RECHECK_PROXY_STAGE_OUTPUT_ROOT" ||
    return 1
  (umask 077 && printf '%s\n' 'controller_not_started' >"$KEMERBET_RECHECK_CONTROLLER_STAGE") ||
    return 1
  (umask 077 && printf '%s\n' 'browser_not_started' >"$KEMERBET_RECHECK_BROWSER_STAGE") ||
    return 1
  (umask 077 && printf '%s\n' 'proxy_not_started' >"$KEMERBET_RECHECK_PROXY_STAGE") ||
    return 1
  chown 10002:10002 "$KEMERBET_RECHECK_CONTROLLER_STAGE" || return 1
  chown 10001:10001 "$KEMERBET_RECHECK_BROWSER_STAGE" || return 1
  chown 10003:10003 "$KEMERBET_RECHECK_PROXY_STAGE" || return 1
  chmod 0400 "$KEMERBET_RECHECK_CONTROLLER_STAGE" \
    "$KEMERBET_RECHECK_BROWSER_STAGE" "$KEMERBET_RECHECK_PROXY_STAGE" || return 1
  sync -f "$KEMERBET_RECHECK_CONTROLLER_STAGE" || return 1
  sync -f "$KEMERBET_RECHECK_BROWSER_STAGE" || return 1
  sync -f "$KEMERBET_RECHECK_PROXY_STAGE" || return 1
  sync -f "$KEMERBET_RECHECK_CONTROLLER_STAGE_OUTPUT_ROOT" || return 1
  sync -f "$KEMERBET_RECHECK_BROWSER_STAGE_OUTPUT_ROOT" || return 1
  sync -f "$KEMERBET_RECHECK_PROXY_STAGE_OUTPUT_ROOT" || return 1
  rm -f -- "$KEMERBET_RECHECK_RPC_INSTALLING" \
    "$KEMERBET_RECHECK_PROXY_HMAC_INSTALLING" \
    "$KEMERBET_RECHECK_PROXY_NONCE_INSTALLING" \
    "$KEMERBET_RECHECK_RPC_ROOT/.account-id.installing" \
    "$KEMERBET_RECHECK_RPC_ROOT/.release-sha.installing" || return 1
  sync -f "$KEMERBET_RECHECK_RPC_ROOT" || return 1
}

require_kemerbet_recheck_oneshot_container_contract() {
  local container_id="$1" expected_name="$2" expected_label="$3" expected_user="$4"
  local image_id="$5" expected_command="$6" expected_mounts="$7" expected_cap_add="$8"
  local observed_mounts
  [[ "$container_id" =~ ^[0-9a-f]{64}$ && "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  [[ "$(docker_local container inspect "$container_id" \
    --format '{{.Id}}|{{.Name}}|{{.Image}}|{{ index .Config.Labels "com.docker.compose.project" }}|{{ index .Config.Labels "com.fetanagent.kemerbet-readiness.oneshot" }}|{{json .Config.Entrypoint}}|{{json .Config.Cmd}}')" == \
    "$container_id|/$expected_name|$image_id|$PROJECT_NAME|$expected_label|[\"node\"]|$expected_command" ]] ||
    return 1
  [[ "$(docker_local container inspect "$container_id" \
    --format '{{.Config.User}}|{{.HostConfig.ReadonlyRootfs}}|{{.HostConfig.Privileged}}|{{.HostConfig.NetworkMode}}|{{.HostConfig.LogConfig.Type}}|{{.HostConfig.RestartPolicy.Name}}|{{.HostConfig.AutoRemove}}|{{json .HostConfig.CapAdd}}|{{json .HostConfig.CapDrop}}|{{json .HostConfig.SecurityOpt}}|{{json .HostConfig.PortBindings}}|{{json .HostConfig.Dns}}')" == \
    "$expected_user|true|false|none|none|no|false|$expected_cap_add|[\"ALL\"]|[\"no-new-privileges:true\"]|{}|null" ]] ||
    return 1
  [[ "$(docker_local container inspect "$container_id" \
    --format '{{.HostConfig.Memory}}|{{.HostConfig.NanoCpus}}|{{.HostConfig.PidsLimit}}')" == \
    '67108864|250000000|64' ]] || return 1
  observed_mounts="$(docker_local container inspect "$container_id" \
    --format '{{range .Mounts}}{{printf "%s|%s|%s|%t|%s\n" .Type .Name .Destination .RW .Source}}{{end}}' | \
    LC_ALL=C sed '/^$/d' | \
    LC_ALL=C sort)" || return 1
  [[ "$observed_mounts" == "$expected_mounts" ]] || return 1
  [[ "$(docker_local container inspect "$container_id" \
    --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}')" == 'none' ]]
}

wait_kemerbet_recheck_container_exit_zero() {
  local container_id="$1" result status=0
  [[ "$container_id" =~ ^[0-9a-f]{64}$ ]] || return 1
  result=''
  if result="$(timeout --foreground --signal=TERM \
    --kill-after="${KEMERBET_RECHECK_KILL_AFTER_SECONDS}s" \
    "${KEMERBET_RECHECK_TIMEOUT_SECONDS}s" \
    env -i PATH="$SAFE_PATH" HOME='/root' DOCKER_HOST="$LOCAL_DOCKER_SOCKET" \
    docker --host "$LOCAL_DOCKER_SOCKET" container wait "$container_id" 2>/dev/null)"; then
    [[ "$result" == '0' ]] || status=1
  else
    status=$?
  fi
  [[ "$status" -eq 0 && "$result" == '0' &&
    "$(docker_local container inspect "$container_id" \
      --format '{{.State.Status}}|{{.State.ExitCode}}|{{.State.OOMKilled}}|{{.State.Error}}|{{.RestartCount}}')" == \
      'exited|0|false||0' ]]
}

run_kemerbet_recheck_authorization_premint() {
  local container_id expected_mounts image_id="$1"
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  [[ -z "$(docker_local container ls --all --quiet \
    --filter "name=^/$KEMERBET_RECHECK_AUTHORIZER_CONTAINER$")" ]] || return 1
  container_id="$(docker_local container create \
    --name "$KEMERBET_RECHECK_AUTHORIZER_CONTAINER" \
    --label "com.docker.compose.project=$PROJECT_NAME" \
    --label "$KEMERBET_RECHECK_ONESHOT_LABEL=authorization-premint-v1" \
    --network none \
    --read-only \
    --user 10004:10004 \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --pids-limit 64 \
    --memory 67108864 \
    --cpus 0.25 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16777216,mode=1777 \
    --log-driver none \
    --mount "type=bind,src=$KEMERBET_RECHECK_AUTHORIZER_PLAYER_IDS,dst=/run/secrets/kemerbet_no_transfer_readiness_player_ids,readonly" \
    --mount "type=bind,src=$KEMERBET_RECHECK_AUTHORIZER_HMAC_KEY,dst=/run/secrets/kemerbet_readiness_authorizer_hmac_key,readonly" \
    --mount "type=bind,src=$KEMERBET_RECHECK_AUTHORIZER_RUN_NONCE,dst=/run/secrets/kemerbet_readiness_authorizer_run_nonce,readonly" \
    --mount "type=bind,src=$KEMERBET_RECHECK_AUTHORIZER_OUTPUT_ROOT,dst=/run/output" \
    --entrypoint node \
    "$image_id" apps/executor/dist/kemerbet-readiness-authorization-premint.js)" || return 1
  [[ "$container_id" =~ ^[0-9a-f]{64}$ ]] || return 1
  expected_mounts="$(printf '%s\n' \
    "bind||/run/output|true|$KEMERBET_RECHECK_AUTHORIZER_OUTPUT_ROOT" \
    "bind||/run/secrets/kemerbet_no_transfer_readiness_player_ids|false|$KEMERBET_RECHECK_AUTHORIZER_PLAYER_IDS" \
    "bind||/run/secrets/kemerbet_readiness_authorizer_hmac_key|false|$KEMERBET_RECHECK_AUTHORIZER_HMAC_KEY" \
    "bind||/run/secrets/kemerbet_readiness_authorizer_run_nonce|false|$KEMERBET_RECHECK_AUTHORIZER_RUN_NONCE" | LC_ALL=C sort)"
  require_kemerbet_recheck_oneshot_container_contract \
    "$container_id" "$KEMERBET_RECHECK_AUTHORIZER_CONTAINER" 'authorization-premint-v1' \
    '10004:10004' "$image_id" \
    '["apps/executor/dist/kemerbet-readiness-authorization-premint.js"]' "$expected_mounts" \
    'null' || return 1
  docker_local container start "$container_id" >/dev/null 2>&1 || return 1
  wait_kemerbet_recheck_container_exit_zero "$container_id" || return 1
  require_kemerbet_recheck_runtime_file "$KEMERBET_RECHECK_AUTHORIZER_OUTPUT" \
    '10004:10004:400:1:515' || return 1
  install -o 10002 -g 10002 -m 0400 -T -- "$KEMERBET_RECHECK_AUTHORIZER_OUTPUT" \
    "$KEMERBET_RECHECK_AUTHORIZATIONS" || return 1
  sync -f "$KEMERBET_RECHECK_AUTHORIZATIONS" || return 1
  rm -f -- "$KEMERBET_RECHECK_AUTHORIZER_OUTPUT" || return 1
  rmdir -- "$KEMERBET_RECHECK_AUTHORIZER_OUTPUT_ROOT" || return 1
  sync -f "$KEMERBET_RECHECK_RPC_ROOT" || return 1
  docker_local container rm "$container_id" >/dev/null 2>&1 || return 1
  require_kemerbet_recheck_authorizations_contract
}

run_kemerbet_recheck_profile_snapshot_copy() {
  local account_id="$1" container_id expected_mounts image_id="$2"
  local source_mountpoint snapshot_mountpoint
  [[ "$account_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ &&
    "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  require_kemerbet_profile_volume_holders '' || return 1
  kemerbet_recheck_profile_snapshot_volume_holders_match '' || return 1
  source_mountpoint="$(resolve_kemerbet_profile_volume_mountpoint)" || return 1
  snapshot_mountpoint="$(resolve_kemerbet_recheck_profile_snapshot_mountpoint '0:0:700')" || return 1
  [[ ! -e "$KEMERBET_RECHECK_PROFILE_MANIFEST" &&
    ! -L "$KEMERBET_RECHECK_PROFILE_MANIFEST" ]] || return 1
  container_id="$(docker_local container create \
    --name "$KEMERBET_RECHECK_SNAPSHOT_CONTAINER" \
    --label "com.docker.compose.project=$PROJECT_NAME" \
    --label "$KEMERBET_RECHECK_ONESHOT_LABEL=profile-snapshot-copy-v1" \
    --network none \
    --read-only \
    --user 0:0 \
    --cap-drop ALL \
    --cap-add CHOWN \
    --cap-add DAC_OVERRIDE \
    --cap-add FOWNER \
    --security-opt no-new-privileges:true \
    --pids-limit 64 \
    --memory 67108864 \
    --cpus 0.25 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16777216,mode=1777 \
    --log-driver none \
    --mount "type=volume,src=$KEMERBET_PROFILE_VOLUME,dst=/run/source,readonly" \
    --mount "type=volume,src=$KEMERBET_RECHECK_PROFILE_SNAPSHOT_VOLUME,dst=/run/snapshot" \
    --mount "type=bind,src=$KEMERBET_RECHECK_SNAPSHOT_ACCOUNT_ID,dst=/run/secrets/kemerbet_readiness_account_id,readonly" \
    --mount "type=bind,src=$KEMERBET_RECHECK_PROFILE_OUTPUT_ROOT,dst=/run/output" \
    --entrypoint node \
    "$image_id" apps/executor/dist/kemerbet-readiness-profile-snapshot.js snapshot)" || return 1
  [[ "$container_id" =~ ^[0-9a-f]{64}$ ]] || return 1
  expected_mounts="$(printf '%s\n' \
    "bind||/run/output|true|$KEMERBET_RECHECK_PROFILE_OUTPUT_ROOT" \
    "bind||/run/secrets/kemerbet_readiness_account_id|false|$KEMERBET_RECHECK_SNAPSHOT_ACCOUNT_ID" \
    "volume|$KEMERBET_PROFILE_VOLUME|/run/source|false|$source_mountpoint" \
    "volume|$KEMERBET_RECHECK_PROFILE_SNAPSHOT_VOLUME|/run/snapshot|true|$snapshot_mountpoint" | LC_ALL=C sort)"
  require_kemerbet_recheck_oneshot_container_contract \
    "$container_id" "$KEMERBET_RECHECK_SNAPSHOT_CONTAINER" 'profile-snapshot-copy-v1' \
    '0:0' "$image_id" \
    '["apps/executor/dist/kemerbet-readiness-profile-snapshot.js","snapshot"]' \
    "$expected_mounts" '["CAP_CHOWN","CAP_DAC_OVERRIDE","CAP_FOWNER"]' || return 1
  kemerbet_recheck_original_profile_volume_holders_match "$container_id" || return 1
  kemerbet_recheck_profile_snapshot_volume_holders_match "$container_id" || return 1
  docker_local container start "$container_id" >/dev/null 2>&1 || return 1
  wait_kemerbet_recheck_container_exit_zero "$container_id" || return 1
  docker_local container rm "$container_id" >/dev/null 2>&1 || return 1
  require_kemerbet_profile_volume_holders ''
  kemerbet_recheck_profile_snapshot_volume_holders_match '' || return 1
  resolve_kemerbet_recheck_profile_snapshot_mountpoint '0:0:700' >/dev/null || return 1
  require_kemerbet_recheck_profile_manifest_contract "$account_id"
}

run_kemerbet_recheck_profile_snapshot_verify() {
  local account_id="$1" expected_owner="$2" container_id expected_mounts image_id="$3"
  local snapshot_mountpoint
  [[ "$account_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ &&
    ( "$expected_owner" == '0:0:700' || "$expected_owner" == '10001:10001:700' ) &&
    "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  require_kemerbet_profile_volume_holders '' || return 1
  kemerbet_recheck_profile_snapshot_volume_holders_match '' || return 1
  snapshot_mountpoint="$(resolve_kemerbet_recheck_profile_snapshot_mountpoint "$expected_owner")" ||
    return 1
  container_id="$(docker_local container create \
    --name "$KEMERBET_RECHECK_SNAPSHOT_VERIFY_CONTAINER" \
    --label "com.docker.compose.project=$PROJECT_NAME" \
    --label "$KEMERBET_RECHECK_ONESHOT_LABEL=profile-snapshot-verify-v1" \
    --network none \
    --read-only \
    --user 0:0 \
    --cap-drop ALL \
    --cap-add DAC_OVERRIDE \
    --security-opt no-new-privileges:true \
    --pids-limit 64 \
    --memory 67108864 \
    --cpus 0.25 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16777216,mode=1777 \
    --log-driver none \
    --mount "type=volume,src=$KEMERBET_RECHECK_PROFILE_SNAPSHOT_VOLUME,dst=/run/source,readonly" \
    --mount "type=bind,src=$KEMERBET_RECHECK_SNAPSHOT_ACCOUNT_ID,dst=/run/secrets/kemerbet_readiness_account_id,readonly" \
    --mount "type=bind,src=$KEMERBET_RECHECK_PROFILE_OUTPUT_ROOT,dst=/run/output,readonly" \
    --entrypoint node \
    "$image_id" apps/executor/dist/kemerbet-readiness-profile-snapshot.js verify)" || return 1
  [[ "$container_id" =~ ^[0-9a-f]{64}$ ]] || return 1
  expected_mounts="$(printf '%s\n' \
    "bind||/run/output|false|$KEMERBET_RECHECK_PROFILE_OUTPUT_ROOT" \
    "bind||/run/secrets/kemerbet_readiness_account_id|false|$KEMERBET_RECHECK_SNAPSHOT_ACCOUNT_ID" \
    "volume|$KEMERBET_RECHECK_PROFILE_SNAPSHOT_VOLUME|/run/source|false|$snapshot_mountpoint" | LC_ALL=C sort)"
  require_kemerbet_recheck_oneshot_container_contract \
    "$container_id" "$KEMERBET_RECHECK_SNAPSHOT_VERIFY_CONTAINER" 'profile-snapshot-verify-v1' \
    '0:0' "$image_id" \
    '["apps/executor/dist/kemerbet-readiness-profile-snapshot.js","verify"]' \
    "$expected_mounts" '["CAP_DAC_OVERRIDE"]' || return 1
  require_kemerbet_profile_volume_holders ''
  kemerbet_recheck_profile_snapshot_volume_holders_match "$container_id" || return 1
  docker_local container start "$container_id" >/dev/null 2>&1 || return 1
  wait_kemerbet_recheck_container_exit_zero "$container_id" || return 1
  docker_local container rm "$container_id" >/dev/null 2>&1 || return 1
  require_kemerbet_profile_volume_holders ''
  kemerbet_recheck_profile_snapshot_volume_holders_match '' || return 1
  resolve_kemerbet_recheck_profile_snapshot_mountpoint "$expected_owner" >/dev/null || return 1
  require_kemerbet_recheck_profile_manifest_contract "$account_id"
}

run_kemerbet_recheck_original_profile_verify() {
  local account_id="$1" container_id expected_mounts image_id="$2" source_mountpoint
  [[ "$account_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ &&
    "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  require_kemerbet_profile_volume_holders '' || return 1
  source_mountpoint="$(resolve_kemerbet_profile_volume_mountpoint)" || return 1
  container_id="$(docker_local container create \
    --name "$KEMERBET_RECHECK_ORIGINAL_VERIFY_CONTAINER" \
    --label "com.docker.compose.project=$PROJECT_NAME" \
    --label "$KEMERBET_RECHECK_ONESHOT_LABEL=profile-original-verify-v1" \
    --network none \
    --read-only \
    --user 0:0 \
    --cap-drop ALL \
    --cap-add DAC_OVERRIDE \
    --security-opt no-new-privileges:true \
    --pids-limit 64 \
    --memory 67108864 \
    --cpus 0.25 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16777216,mode=1777 \
    --log-driver none \
    --mount "type=volume,src=$KEMERBET_PROFILE_VOLUME,dst=/run/source,readonly" \
    --mount "type=bind,src=$KEMERBET_RECHECK_SNAPSHOT_ACCOUNT_ID,dst=/run/secrets/kemerbet_readiness_account_id,readonly" \
    --mount "type=bind,src=$KEMERBET_RECHECK_PROFILE_OUTPUT_ROOT,dst=/run/output,readonly" \
    --entrypoint node \
    "$image_id" apps/executor/dist/kemerbet-readiness-profile-snapshot.js verify-original)" || return 1
  [[ "$container_id" =~ ^[0-9a-f]{64}$ ]] || return 1
  expected_mounts="$(printf '%s\n' \
    "bind||/run/output|false|$KEMERBET_RECHECK_PROFILE_OUTPUT_ROOT" \
    "bind||/run/secrets/kemerbet_readiness_account_id|false|$KEMERBET_RECHECK_SNAPSHOT_ACCOUNT_ID" \
    "volume|$KEMERBET_PROFILE_VOLUME|/run/source|false|$source_mountpoint" | LC_ALL=C sort)"
  require_kemerbet_recheck_oneshot_container_contract \
    "$container_id" "$KEMERBET_RECHECK_ORIGINAL_VERIFY_CONTAINER" 'profile-original-verify-v1' \
    '0:0' "$image_id" \
    '["apps/executor/dist/kemerbet-readiness-profile-snapshot.js","verify-original"]' \
    "$expected_mounts" '["CAP_DAC_OVERRIDE"]' || return 1
  kemerbet_recheck_original_profile_volume_holders_match "$container_id" || return 1
  docker_local container start "$container_id" >/dev/null 2>&1 || return 1
  wait_kemerbet_recheck_container_exit_zero "$container_id" || return 1
  docker_local container rm "$container_id" >/dev/null 2>&1 || return 1
  require_kemerbet_profile_volume_holders ''
  require_kemerbet_recheck_profile_manifest_contract "$account_id"
}

prepare_kemerbet_recheck_profile_snapshot() {
  local account_id="$1" image_id="$2" account_stat manifest_digest mountpoint root_entries
  create_kemerbet_recheck_profile_snapshot_volume || return 1
  run_kemerbet_recheck_profile_snapshot_copy "$account_id" "$image_id" || return 1
  run_kemerbet_recheck_profile_snapshot_verify "$account_id" '0:0:700' "$image_id" || return 1
  mountpoint="$(resolve_kemerbet_recheck_profile_snapshot_mountpoint '0:0:700')" || return 1
  root_entries="$(find -P "$mountpoint" -mindepth 1 -maxdepth 1 -printf '%f\n')" || return 1
  [[ "$root_entries" == "$account_id" && ! -L "$mountpoint/$account_id" &&
    -d "$mountpoint/$account_id" && "$(realpath -- "$mountpoint/$account_id")" == "$mountpoint/$account_id" &&
    "$(stat --format='%u:%g:%a' "$mountpoint/$account_id")" == '10001:10001:700' ]] || return 1
  account_stat="$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$mountpoint/$account_id")" || return 1
  manifest_digest="$(sha256sum -- "$KEMERBET_RECHECK_PROFILE_MANIFEST" | awk '{print $1}')" || return 1
  [[ "$manifest_digest" =~ ^[0-9a-f]{64}$ ]] || return 1
  chown 10001:10001 "$mountpoint" || return 1
  chmod 0700 "$mountpoint" || return 1
  sync -f "$mountpoint" || return 1
  [[ "$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$mountpoint/$account_id")" == "$account_stat" &&
    "$(sha256sum -- "$KEMERBET_RECHECK_PROFILE_MANIFEST" | awk '{print $1}')" == "$manifest_digest" ]] ||
    return 1
  resolve_kemerbet_recheck_profile_snapshot_mountpoint '10001:10001:700' >/dev/null || return 1
  run_kemerbet_recheck_profile_snapshot_verify "$account_id" '10001:10001:700' "$image_id" ||
    return 1
  [[ "$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$mountpoint/$account_id")" == "$account_stat" &&
    "$(sha256sum -- "$KEMERBET_RECHECK_PROFILE_MANIFEST" | awk '{print $1}')" == "$manifest_digest" ]]
}

require_kemerbet_recheck_transients_absent() {
  local identifier name
  for name in \
    "$KEMERBET_RECHECK_CONTAINER" \
    "$KEMERBET_RECHECK_BROWSER_CONTAINER" \
    "$KEMERBET_RECHECK_PROXY_CONTAINER" \
    "$KEMERBET_RECHECK_AUTHORIZER_CONTAINER" \
    "$KEMERBET_RECHECK_SNAPSHOT_CONTAINER" \
    "$KEMERBET_RECHECK_SNAPSHOT_VERIFY_CONTAINER" \
    "$KEMERBET_RECHECK_ORIGINAL_VERIFY_CONTAINER"; do
    identifier="$(docker_local container ls --all --quiet --filter "name=^/${name}$")" || return 1
    [[ -z "$identifier" ]] || return 1
  done
  for name in \
    "$KEMERBET_RECHECK_CONTROL_NETWORK" \
    "$KEMERBET_RECHECK_PROXY_NETWORK" \
    "$KEMERBET_RECHECK_EGRESS_NETWORK"; do
    identifier="$(docker_local network ls --quiet --filter "name=^${name}$")" || return 1
    [[ -z "$identifier" ]] || return 1
  done
  [[ -z "$(docker_local volume ls --quiet \
    --filter "name=^${KEMERBET_RECHECK_PROFILE_SNAPSHOT_VOLUME}$")" &&
    ! -e "$KEMERBET_RECHECK_RPC_ROOT" && ! -L "$KEMERBET_RECHECK_RPC_ROOT" ]]
}

remove_kemerbet_recheck_candidate() {
  local candidate_mode root_mode
  if [[ ! -e "$KEMERBET_RECHECK_CANDIDATE_ROOT" && ! -L "$KEMERBET_RECHECK_CANDIDATE_ROOT" ]]; then
    return 0
  fi
  [[ ! -L "$KEMERBET_RECHECK_CANDIDATE_ROOT" && -d "$KEMERBET_RECHECK_CANDIDATE_ROOT" ]] ||
    return 1
  [[ "$(realpath -- "$KEMERBET_RECHECK_CANDIDATE_ROOT")" == "$KEMERBET_RECHECK_CANDIDATE_ROOT" ]] ||
    return 1
  [[ "$(stat --format='%U:%G' "$KEMERBET_RECHECK_CANDIDATE_ROOT")" == 'root:root' ]] || return 1
  root_mode="$(stat --format='%a' "$KEMERBET_RECHECK_CANDIDATE_ROOT")" || return 1
  [[ "$root_mode" =~ ^[0-7]{3,4}$ ]] || return 1
  (( (8#$root_mode & 8#022) == 0 )) || return 1
  if [[ -e "$KEMERBET_RECHECK_CANDIDATE_BINDING" || -L "$KEMERBET_RECHECK_CANDIDATE_BINDING" ]]; then
    [[ ! -L "$KEMERBET_RECHECK_CANDIDATE_BINDING" && -f "$KEMERBET_RECHECK_CANDIDATE_BINDING" ]] ||
      return 1
    [[ "$(realpath -- "$KEMERBET_RECHECK_CANDIDATE_BINDING")" == \
      "$KEMERBET_RECHECK_CANDIDATE_BINDING" ]] || return 1
    [[ "$(stat --format='%U:%G' "$KEMERBET_RECHECK_CANDIDATE_BINDING")" == 'root:root' ]] || return 1
    candidate_mode="$(stat --format='%a' "$KEMERBET_RECHECK_CANDIDATE_BINDING")" || return 1
    [[ "$candidate_mode" =~ ^[0-7]{3,4}$ ]] || return 1
    (( (8#$candidate_mode & 8#022) == 0 )) || return 1
    rm -f -- "$KEMERBET_RECHECK_CANDIDATE_BINDING" || return 1
  fi
  rmdir -- "$KEMERBET_RECHECK_CANDIDATE_ROOT" >/dev/null 2>&1 || return 1
  sync -f "$(dirname -- "$KEMERBET_RECHECK_CANDIDATE_ROOT")" >/dev/null 2>&1 || return 1
  [[ ! -e "$KEMERBET_RECHECK_CANDIDATE_ROOT" && ! -L "$KEMERBET_RECHECK_CANDIDATE_ROOT" ]]
}

KEMERBET_RECHECK_CLEANUP_ARMED='false'
KEMERBET_RECHECK_CANDIDATE_CREATED='false'
KEMERBET_RECHECK_CANDIDATE_DEV_INO=''
KEMERBET_RECHECK_CANDIDATE_DIGEST=''
KEMERBET_RECHECK_FINAL_INSTALLED='false'
KEMERBET_RECHECK_RECEIPT_OWNED='false'
KEMERBET_RECHECK_PROMOTION_OWNED='false'
KEMERBET_RECHECK_PLAYER_IDS_DEV_INO=''
KEMERBET_RECHECK_PLAYER_IDS_DIGEST=''
KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO=''
KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO=''
KEMERBET_RECHECK_OWNER_CLAIM_ID=''
KEMERBET_RECHECK_RELEASE=''
KEMERBET_RECHECK_SESSION_CONTAINER=''
KEMERBET_RECHECK_SOURCE_DEV_INO=''
KEMERBET_RECHECK_SOURCE_DIGEST=''
KEMERBET_RECHECK_IDENTITY_KEY_DIGEST=''
KEMERBET_RECHECK_COMMITTED='false'
KEMERBET_RECHECK_DURABLE_SUCCESS='false'
KEMERBET_RECHECK_RECOVERY_OUTCOME=''
KEMERBET_TEARDOWN_RECOVERY_FAILED='false'
KEMERBET_EMERGENCY_TEARDOWN_FAILED='false'
KEMERBET_RECOVERY_LATCH_DEV_INO=''
KEMERBET_RECHECK_CONTROLLER_FIREWALL_V4_DIGEST=''
KEMERBET_RECHECK_CONTROLLER_FIREWALL_V6_DIGEST=''
KEMERBET_RECHECK_BROWSER_FIREWALL_V4_DIGEST=''
KEMERBET_RECHECK_BROWSER_FIREWALL_V6_DIGEST=''
KEMERBET_RECHECK_CONTROLLER_NETNS_FD=''
KEMERBET_RECHECK_CONTROLLER_NETNS_CONTAINER_ID=''
KEMERBET_RECHECK_CONTROLLER_NETNS_PID=''
KEMERBET_RECHECK_CONTROLLER_NETNS_IDENTITY=''
KEMERBET_RECHECK_BROWSER_NETNS_FD=''
KEMERBET_RECHECK_BROWSER_NETNS_CONTAINER_ID=''
KEMERBET_RECHECK_BROWSER_NETNS_PID=''
KEMERBET_RECHECK_BROWSER_NETNS_IDENTITY=''

require_retryable_kemerbet_binding_source() {
  local expected_dev_ino="$1" expected_digest="$2"
  [[ "$expected_dev_ino" =~ ^[0-9]+:[0-9]+$ && "$expected_digest" =~ ^[0-9a-f]{64}$ ]] ||
    return 1
  [[ ! -L "$KEMERBET_READINESS_BINDING" && -f "$KEMERBET_READINESS_BINDING" ]] || return 1
  [[ "$(stat --format='%d:%i:%u:%g:%a:%h:%s' "$KEMERBET_READINESS_BINDING")" == \
    "$expected_dev_ino:10001:10001:600:1:230" &&
    "$(wc -l <"$KEMERBET_READINESS_BINDING")" == '1' &&
    "$(sha256sum -- "$KEMERBET_READINESS_BINDING" | awk '{print $1}')" == "$expected_digest" ]] ||
    return 1
  require_kemerbet_v3_binding_content "$KEMERBET_READINESS_BINDING" || return 1
  require_kemerbet_readiness_output_directory >/dev/null 2>&1
}

consume_exact_kemerbet_binding_source() {
  consume_exact_one_use_kemerbet_file "$KEMERBET_READINESS_BINDING" "$1" "$2"
}

rollback_kemerbet_recheck_final_binding() {
  local final_dev_ino final_digest
  if [[ ! -e "$KEMERBET_AGENT_IDENTITY_BINDINGS" && ! -L "$KEMERBET_AGENT_IDENTITY_BINDINGS" ]]; then
    return 0
  fi
  [[ ! -L "$KEMERBET_AGENT_IDENTITY_BINDINGS" && -f "$KEMERBET_AGENT_IDENTITY_BINDINGS" ]] ||
    return 1
  [[ "$(realpath -- "$KEMERBET_AGENT_IDENTITY_BINDINGS")" == "$KEMERBET_AGENT_IDENTITY_BINDINGS" ]] ||
    return 1
  [[ "$(stat --format='%U:%G:%s' "$KEMERBET_AGENT_IDENTITY_BINDINGS")" == \
    'root:root:230' ]] || return 1
  final_dev_ino="$(stat --format='%d:%i' "$KEMERBET_AGENT_IDENTITY_BINDINGS")" || return 1
  final_digest="$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_BINDINGS" | awk '{print $1}')" || return 1
  [[ -n "$KEMERBET_RECHECK_CANDIDATE_DEV_INO" &&
    "$final_dev_ino" == "$KEMERBET_RECHECK_CANDIDATE_DEV_INO" &&
    "$final_digest" == "$KEMERBET_RECHECK_CANDIDATE_DIGEST" ]] || return 1
  rm -f -- "$KEMERBET_AGENT_IDENTITY_BINDINGS" || return 1
  sync -f "$(dirname -- "$KEMERBET_AGENT_IDENTITY_BINDINGS")" >/dev/null 2>&1 || return 1
  [[ ! -e "$KEMERBET_AGENT_IDENTITY_BINDINGS" && ! -L "$KEMERBET_AGENT_IDENTITY_BINDINGS" ]]
}

remove_owned_kemerbet_recheck_receipt_root() {
  local entry entry_mode root_mode
  if [[ ! -e "$KEMERBET_RECHECK_RECEIPT_ROOT" && ! -L "$KEMERBET_RECHECK_RECEIPT_ROOT" ]]; then
    return 0
  fi
  [[ ! -L "$KEMERBET_RECHECK_RECEIPT_ROOT" && -d "$KEMERBET_RECHECK_RECEIPT_ROOT" ]] ||
    return 1
  [[ "$(realpath -- "$KEMERBET_RECHECK_RECEIPT_ROOT")" == "$KEMERBET_RECHECK_RECEIPT_ROOT" ]] ||
    return 1
  [[ "$(stat --format='%U:%G' "$KEMERBET_RECHECK_RECEIPT_ROOT")" == 'root:root' ]] || return 1
  root_mode="$(stat --format='%a' "$KEMERBET_RECHECK_RECEIPT_ROOT")" || return 1
  [[ "$root_mode" =~ ^[0-7]{3,4}$ ]] || return 1
  (( (8#$root_mode & 8#022) == 0 )) || return 1
  while IFS= read -r -d '' entry; do
    [[ "$entry" == "$KEMERBET_RECHECK_RECEIPT" ||
      "$entry" == "$KEMERBET_RECHECK_RECEIPT_ROOT"/.ready-v1.* ]] || return 1
    [[ ! -L "$entry" && -f "$entry" && "$(stat --format='%U:%G' "$entry")" == 'root:root' ]] ||
      return 1
    entry_mode="$(stat --format='%a' "$entry")" || return 1
    [[ "$entry_mode" =~ ^[0-7]{3,4}$ ]] || return 1
    (( (8#$entry_mode & 8#022) == 0 )) || return 1
  done < <(find -P "$KEMERBET_RECHECK_RECEIPT_ROOT" -mindepth 1 -maxdepth 1 -print0)
  find -P "$KEMERBET_RECHECK_RECEIPT_ROOT" -mindepth 1 -maxdepth 1 -type f -delete || return 1
  rmdir -- "$KEMERBET_RECHECK_RECEIPT_ROOT" >/dev/null 2>&1 || return 1
  sync -f "$(dirname -- "$KEMERBET_RECHECK_RECEIPT_ROOT")" >/dev/null 2>&1 || return 1
  [[ ! -e "$KEMERBET_RECHECK_RECEIPT_ROOT" && ! -L "$KEMERBET_RECHECK_RECEIPT_ROOT" ]]
}

remove_owned_kemerbet_recheck_promotion_root() {
  local entry entry_mode root_mode
  if [[ ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" ]]; then
    return 0
  fi
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" && -d "$KEMERBET_RECHECK_PROMOTION_ROOT" ]] ||
    return 1
  [[ "$(realpath -- "$KEMERBET_RECHECK_PROMOTION_ROOT")" == "$KEMERBET_RECHECK_PROMOTION_ROOT" ]] ||
    return 1
  [[ "$(stat --format='%U:%G' "$KEMERBET_RECHECK_PROMOTION_ROOT")" == 'root:root' ]] || return 1
  root_mode="$(stat --format='%a' "$KEMERBET_RECHECK_PROMOTION_ROOT")" || return 1
  [[ "$root_mode" =~ ^[0-7]{3,4}$ ]] || return 1
  (( (8#$root_mode & 8#022) == 0 )) || return 1
  [[ ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT/$KEMERBET_RECOVERY_FALLBACK_NAME" &&
    ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT/$KEMERBET_RECOVERY_FALLBACK_NAME" &&
    ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT/$KEMERBET_RECOVERY_FALLBACK_INSTALLING_NAME" &&
    ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT/$KEMERBET_RECOVERY_FALLBACK_INSTALLING_NAME" ]] ||
    return 1
  while IFS= read -r -d '' entry; do
    [[ "$entry" == "$KEMERBET_RECHECK_PROMOTION_JOURNAL" ||
      "$entry" == "$KEMERBET_RECHECK_PROMOTION_ROOT"/.pending-v1.* ]] || return 1
    [[ ! -L "$entry" && -f "$entry" && "$(stat --format='%U:%G' "$entry")" == 'root:root' ]] ||
      return 1
    entry_mode="$(stat --format='%a' "$entry")" || return 1
    [[ "$entry_mode" =~ ^[0-7]{3,4}$ ]] || return 1
    (( (8#$entry_mode & 8#022) == 0 )) || return 1
  done < <(find -P "$KEMERBET_RECHECK_PROMOTION_ROOT" -mindepth 1 -maxdepth 1 -print0)
  find -P "$KEMERBET_RECHECK_PROMOTION_ROOT" -mindepth 1 -maxdepth 1 -type f -delete || return 1
  rmdir -- "$KEMERBET_RECHECK_PROMOTION_ROOT" >/dev/null 2>&1 || return 1
  sync -f "$(dirname -- "$KEMERBET_RECHECK_PROMOTION_ROOT")" >/dev/null 2>&1 || return 1
  [[ ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" ]]
}

repair_kemerbet_identity_key_readability() {
  local metadata parent parent_mode
  parent="$(dirname -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")"
  [[ ! -L "$parent" && -d "$parent" && "$(realpath -- "$parent")" == "$parent" &&
    "$(stat --format='%U:%G' "$parent")" == 'root:root' ]] || return 1
  parent_mode="$(stat --format='%a' "$parent")" || return 1
  case "$parent_mode" in
    700) ;;
    755) chmod 0700 "$parent" >/dev/null 2>&1 || return 1 ;;
    *) return 1 ;;
  esac
  [[ "$(stat --format='%U:%G:%a' "$parent")" == 'root:root:700' ]] || return 1
  sync -f "$parent" >/dev/null 2>&1 || return 1
  [[ ! -L "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" && -f "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" ]] ||
    return 1
  [[ "$(stat --format='%h' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")" == '1' ]] || return 1
  metadata="$(stat --format='%u:%g:%a' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")"
  case "$metadata" in
    0:0:444) return 0 ;;
    10001:10001:400|10001:10001:444|0:0:400) ;;
    *) return 1 ;;
  esac
  chown root:root "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" >/dev/null 2>&1 || return 1
  chmod 0444 "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" >/dev/null 2>&1 || return 1
  sync -f "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" >/dev/null 2>&1 || return 1
  [[ "$(stat --format='%U:%G:%a' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")" == 'root:root:444' ]]
}

kemerbet_recheck_cleanup_trap() {
  local original_status=$?
  local cleanup_status=0
  local containers_quiesced='false'
  trap - EXIT
  trap '' INT TERM HUP
  set +e
  if [[ "$KEMERBET_RECHECK_CLEANUP_ARMED" == 'true' ]]; then
    close_all_pinned_kemerbet_recheck_network_namespaces || cleanup_status=1
    if remove_kemerbet_recheck_container; then
      containers_quiesced='true'
    else
      cleanup_status=1
    fi
    if [[ "$original_status" -ne 0 ]]; then
      if [[ "$containers_quiesced" == 'true' &&
        -e "$KEMERBET_RECHECK_CONTROLLER_STAGE_OUTPUT_ROOT" &&
        -e "$KEMERBET_RECHECK_BROWSER_STAGE_OUTPUT_ROOT" &&
        -e "$KEMERBET_RECHECK_PROXY_STAGE_OUTPUT_ROOT" ]]; then
        print_kemerbet_recheck_fixed_failure_stages ||
          printf '%s\n' 'KemerBet readiness fixed stage output is unavailable.' >&2
      elif [[ "$containers_quiesced" != 'true' ||
        -e "$KEMERBET_RECHECK_CONTROLLER_STAGE_OUTPUT_ROOT" ||
        -e "$KEMERBET_RECHECK_BROWSER_STAGE_OUTPUT_ROOT" ||
        -e "$KEMERBET_RECHECK_PROXY_STAGE_OUTPUT_ROOT" ]]; then
        printf '%s\n' 'KemerBet readiness fixed stage output is unavailable.' >&2
      fi
    fi
    # Retry the disposable snapshot-volume removal independently. The container cleanup normally
    # removes it, but a rejected or partially-created sibling container must not prevent removal
    # of an otherwise holder-free partial snapshot after an offline copy/verification failure.
    remove_kemerbet_recheck_profile_snapshot_volume || cleanup_status=1
    remove_kemerbet_recheck_network || cleanup_status=1
    remove_kemerbet_recheck_rpc_capabilities || cleanup_status=1
    if [[ -n "$KEMERBET_RECHECK_RELEASE" && -n "$KEMERBET_RECHECK_SESSION_CONTAINER" ]]; then
      remove_exact_kemerbet_session_provision \
        "$KEMERBET_RECHECK_SESSION_CONTAINER" "$KEMERBET_RECHECK_RELEASE" || cleanup_status=1
    fi
    kemerbet_profile_volume_holders_match '' || cleanup_status=1
    if [[ "$KEMERBET_RECHECK_DURABLE_SUCCESS" != 'true' && "$KEMERBET_RECHECK_COMMITTED" != 'true' ]]; then
      if [[ "$KEMERBET_RECHECK_RECEIPT_OWNED" == 'true' ]]; then
        remove_owned_kemerbet_recheck_receipt_root || cleanup_status=1
      fi
      rollback_kemerbet_recheck_final_binding || cleanup_status=1
      if [[ "$KEMERBET_RECHECK_CANDIDATE_CREATED" == 'true' ]]; then
        remove_kemerbet_recheck_candidate || cleanup_status=1
      fi
      if [[ -n "$KEMERBET_RECHECK_SOURCE_DEV_INO" && -n "$KEMERBET_RECHECK_SOURCE_DIGEST" ]]; then
        require_retryable_kemerbet_binding_source \
          "$KEMERBET_RECHECK_SOURCE_DEV_INO" "$KEMERBET_RECHECK_SOURCE_DIGEST" || cleanup_status=1
      else
        cleanup_status=1
      fi
      if [[ -n "$KEMERBET_RECHECK_PLAYER_IDS_DEV_INO" &&
        -n "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" ]]; then
        consume_exact_one_use_kemerbet_file \
          "$KEMERBET_READINESS_PLAYER_IDS" "$KEMERBET_RECHECK_PLAYER_IDS_DEV_INO" \
          "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" || cleanup_status=1
      else
        # Import may have failed after creating a target but before shell captured its inode.
        # Keep the journal so locked recovery can bind/consume only the exact staged content.
        cleanup_status=1
      fi
      repair_kemerbet_identity_key_readability || cleanup_status=1
      if [[ -n "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" &&
        -n "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" &&
        -n "$KEMERBET_RECHECK_OWNER_CLAIM_ID" &&
        -n "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" ]]; then
        if [[ "$cleanup_status" -eq 0 ]]; then
          # Publish retryable failure only after the sealed binding source remains exact, the
          # internal copy is durably absent, and both digest-bound Owner stages are restored.
          restore_retryable_owner_staged_kemerbet_cohort || cleanup_status=1
        else
          # Best-effort restoration is safe, but an incomplete rollback must retain its journal
          # and must not expose failed-v1 as a directly retryable state.
          restore_owner_staged_kemerbet_cohort || cleanup_status=1
        fi
      else
        cleanup_status=1
      fi
      if [[ "$KEMERBET_RECHECK_PROMOTION_OWNED" == 'true' ]]; then
        # The journal is the crash-recovery authority. Retire it only after every rollback,
        # source-restoration, marker, and secret-repair step succeeded.
        if [[ "$cleanup_status" -eq 0 ]]; then
          remove_owned_kemerbet_recheck_promotion_root || cleanup_status=1
        fi
      fi
    fi
  fi
  if [[ "$original_status" -eq 0 && "$cleanup_status" -ne 0 ]]; then
    original_status=1
  fi
  exit "$original_status"
}

kemerbet_recheck_signal_trap() {
  local status="$1"
  [[ "$status" =~ ^(129|130|143)$ ]] || status=1
  exit "$status"
}

record_kemerbet_recheck_receipt() {
  local commit_sha="$1"
  local binding_digest="$2"
  local identity_key_digest="$3"
  local selector_digest="$4"
  local image_id="$5"
  local profile_identity_digest="$6"
  local temporary
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
    die 'the KemerBet recheck receipt release identity is invalid'
  [[ "$binding_digest" =~ ^[0-9a-f]{64}$ && "$identity_key_digest" =~ ^[0-9a-f]{64}$ &&
    "$selector_digest" =~ ^[0-9a-f]{64}$ && "$profile_identity_digest" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the KemerBet recheck receipt digest contract is invalid'
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] ||
    die 'the KemerBet recheck receipt image identity is invalid'
  [[ ! -e "$KEMERBET_RECHECK_RECEIPT_ROOT" && ! -L "$KEMERBET_RECHECK_RECEIPT_ROOT" ]] ||
    die 'the KemerBet recheck receipt root already exists'
  install -d -o root -g root -m 0700 "$KEMERBET_RECHECK_RECEIPT_ROOT"
  sync -f "$(dirname -- "$KEMERBET_RECHECK_RECEIPT_ROOT")" ||
    die 'the KemerBet recheck receipt parent could not be synchronized'
  temporary="$(mktemp "$KEMERBET_RECHECK_RECEIPT_ROOT/.ready-v1.XXXXXX")" ||
    die 'the KemerBet recheck receipt could not be prepared'
  if ! printf '%s\n' \
    'version=1' \
    "release=$commit_sha" \
    "binding_sha256=$binding_digest" \
    "identity_hmac_key_sha256=$identity_key_digest" \
    "selector_sha256=$selector_digest" \
    "image_id=$image_id" \
    "profile_volume=$KEMERBET_PROFILE_VOLUME" \
    "profile_identity_sha256=$profile_identity_digest" >"$temporary"; then
    rm -f -- "$temporary"
    rmdir -- "$KEMERBET_RECHECK_RECEIPT_ROOT" >/dev/null 2>&1 || true
    die 'the KemerBet recheck receipt could not be written'
  fi
  chown root:root "$temporary"
  chmod 0600 "$temporary"
  sync -f "$temporary" || die 'the KemerBet recheck receipt could not be synchronized'
  if ! ln -- "$temporary" "$KEMERBET_RECHECK_RECEIPT"; then
    rm -f -- "$temporary"
    rmdir -- "$KEMERBET_RECHECK_RECEIPT_ROOT" >/dev/null 2>&1 || true
    die 'the KemerBet recheck receipt could not be sealed atomically'
  fi
  rm -f -- "$temporary"
  sync -f "$KEMERBET_RECHECK_RECEIPT_ROOT" || die 'the KemerBet recheck receipt directory could not be synchronized'
  [[ ! -L "$KEMERBET_RECHECK_RECEIPT" && -f "$KEMERBET_RECHECK_RECEIPT" ]] ||
    die 'the KemerBet recheck receipt is not a safe regular file'
  [[ "$(stat --format='%U:%G:%a' "$KEMERBET_RECHECK_RECEIPT")" == 'root:root:600' ]] ||
    die 'the KemerBet recheck receipt ownership or mode is unsafe'
}

require_kemerbet_recheck_receipt() {
  local commit_sha="$1"
  local binding_digest="$2"
  local identity_key_digest="$3"
  local selector_digest="$4"
  local image_id="$5"
  local profile_identity_digest="$6"
  local actual_digest entries expected_digest
  [[ ! -L "$KEMERBET_RECHECK_RECEIPT_ROOT" && -d "$KEMERBET_RECHECK_RECEIPT_ROOT" ]] ||
    die 'the KemerBet recheck receipt root is absent or symbolic'
  [[ "$(realpath -- "$KEMERBET_RECHECK_RECEIPT_ROOT")" == "$KEMERBET_RECHECK_RECEIPT_ROOT" ]] ||
    die 'the KemerBet recheck receipt root is not canonical'
  [[ "$(stat --format='%U:%G:%a' "$KEMERBET_RECHECK_RECEIPT_ROOT")" == 'root:root:700' ]] ||
    die 'the KemerBet recheck receipt root ownership or mode is unsafe'
  entries="$(find -P "$KEMERBET_RECHECK_RECEIPT_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n')" ||
    die 'the KemerBet recheck receipt root could not be inspected'
  [[ "$entries" == 'ready-v1' ]] || die 'the KemerBet recheck receipt root is not exact'
  [[ ! -L "$KEMERBET_RECHECK_RECEIPT" && -f "$KEMERBET_RECHECK_RECEIPT" ]] ||
    die 'the KemerBet recheck receipt is absent or symbolic'
  [[ "$(realpath -- "$KEMERBET_RECHECK_RECEIPT")" == "$KEMERBET_RECHECK_RECEIPT" ]] ||
    die 'the KemerBet recheck receipt is not canonical'
  [[ "$(stat --format='%U:%G:%a:%h' "$KEMERBET_RECHECK_RECEIPT")" == 'root:root:600:1' ]] ||
    die 'the KemerBet recheck receipt ownership, mode, or link count is unsafe'
  expected_digest="$({
    printf '%s\n' \
      'version=1' \
      "release=$commit_sha" \
      "binding_sha256=$binding_digest" \
      "identity_hmac_key_sha256=$identity_key_digest" \
      "selector_sha256=$selector_digest" \
      "image_id=$image_id" \
      "profile_volume=$KEMERBET_PROFILE_VOLUME" \
      "profile_identity_sha256=$profile_identity_digest"
  } | sha256sum | awk '{print $1}')"
  actual_digest="$(sha256sum -- "$KEMERBET_RECHECK_RECEIPT" | awk '{print $1}')"
  [[ "$actual_digest" == "$expected_digest" ]] ||
    die 'the KemerBet recheck receipt content is not exact'
}

record_kemerbet_recheck_promotion_journal() {
  local commit_sha="$1"
  local source_dev_ino="$2"
  local binding_digest="$3"
  local identity_key_digest="$4"
  local selector_digest="$5"
  local image_id="$6"
  local session_container="$7"
  local owner_player_ids_dev_ino="$8"
  local owner_claim_dev_ino="$9"
  local claim_id="${10}"
  local player_ids_digest="${11}"
  local temporary
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
    die 'the KemerBet promotion-journal release identity is invalid'
  [[ "$source_dev_ino" =~ ^[0-9]+:[0-9]+$ &&
    "$owner_player_ids_dev_ino" =~ ^[0-9]+:[0-9]+$ &&
    "$owner_claim_dev_ino" =~ ^[0-9]+:[0-9]+$ ]] ||
    die 'the KemerBet promotion-journal file identity is invalid'
  [[ "$binding_digest" =~ ^[0-9a-f]{64}$ && "$identity_key_digest" =~ ^[0-9a-f]{64}$ &&
    "$selector_digest" =~ ^[0-9a-f]{64}$ && "$player_ids_digest" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the KemerBet promotion-journal digest contract is invalid'
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] ||
    die 'the KemerBet promotion-journal image identity is invalid'
  [[ "$session_container" == 'none' || "$session_container" =~ ^[0-9a-f]{12,64}$ ]] ||
    die 'the KemerBet promotion-journal session identity is invalid'
  [[ "$claim_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] ||
    die 'the KemerBet promotion-journal claim identity is invalid'
  [[ ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" ]] ||
    die 'the KemerBet promotion-journal root already exists'
  install -d -o root -g root -m 0700 "$KEMERBET_RECHECK_PROMOTION_ROOT"
  sync -f "$(dirname -- "$KEMERBET_RECHECK_PROMOTION_ROOT")" ||
    die 'the KemerBet promotion-journal parent could not be synchronized'
  temporary="$(mktemp "$KEMERBET_RECHECK_PROMOTION_ROOT/.pending-v1.XXXXXX")" ||
    die 'the KemerBet promotion journal could not be prepared'
  if ! printf '%s\n' \
    'version=1' \
    'state=import_prepared' \
    "release=$commit_sha" \
    "source_dev_ino=$source_dev_ino" \
    "binding_sha256=$binding_digest" \
    "identity_hmac_key_sha256=$identity_key_digest" \
    "selector_sha256=$selector_digest" \
    "image_id=$image_id" \
    "profile_volume=$KEMERBET_PROFILE_VOLUME" \
    "session_container=$session_container" \
    "owner_stage_player_ids_dev_ino=$owner_player_ids_dev_ino" \
    "owner_stage_claim_dev_ino=$owner_claim_dev_ino" \
    "claim_id=$claim_id" \
    "player_ids_sha256=$player_ids_digest" >"$temporary"; then
    die 'the KemerBet promotion journal could not be written'
  fi
  chown root:root "$temporary"
  chmod 0600 "$temporary"
  sync -f "$temporary" || die 'the KemerBet promotion journal could not be synchronized'
  ln -- "$temporary" "$KEMERBET_RECHECK_PROMOTION_JOURNAL" ||
    die 'the KemerBet promotion journal could not be sealed without overwrite'
  rm -f -- "$temporary"
  sync -f "$KEMERBET_RECHECK_PROMOTION_ROOT" ||
    die 'the KemerBet promotion-journal root could not be synchronized'
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(stat --format='%U:%G:%a' "$KEMERBET_RECHECK_PROMOTION_ROOT")" == 'root:root:700' ]] ||
    die 'the KemerBet promotion-journal root is unsafe'
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_JOURNAL" &&
    "$(stat --format='%U:%G:%a:%h' "$KEMERBET_RECHECK_PROMOTION_JOURNAL")" == 'root:root:600:1' ]] ||
    die 'the KemerBet promotion journal is unsafe'
}

require_kemerbet_recheck_import_prepared_promotion_journal() {
  local commit_sha="$1" source_dev_ino="$2" binding_digest="$3"
  local identity_key_digest="$4" selector_digest="$5" image_id="$6"
  local session_container="$7" owner_player_ids_dev_ino="$8"
  local owner_claim_dev_ino="$9" claim_id="${10}"
  local player_ids_digest="${11}"
  local actual_digest entries expected_digest
  [[ "$player_ids_digest" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the import-prepared KemerBet Player-ID digest is invalid'
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" && -d "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(realpath -- "$KEMERBET_RECHECK_PROMOTION_ROOT")" == "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(stat --format='%U:%G:%a' "$KEMERBET_RECHECK_PROMOTION_ROOT")" == 'root:root:700' ]] ||
    die 'the import-prepared KemerBet promotion-journal root is unsafe'
  entries="$(find -P "$KEMERBET_RECHECK_PROMOTION_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n')" ||
    die 'the import-prepared KemerBet promotion-journal root could not be inspected'
  [[ "$entries" == 'pending-v1' ]] || die 'the import-prepared KemerBet promotion-journal root is not exact'
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_JOURNAL" && -f "$KEMERBET_RECHECK_PROMOTION_JOURNAL" &&
    "$(realpath -- "$KEMERBET_RECHECK_PROMOTION_JOURNAL")" == "$KEMERBET_RECHECK_PROMOTION_JOURNAL" &&
    "$(stat --format='%U:%G:%a:%h' "$KEMERBET_RECHECK_PROMOTION_JOURNAL")" == 'root:root:600:1' ]] ||
    die 'the import-prepared KemerBet promotion journal is unsafe'
  expected_digest="$({
    printf '%s\n' \
      'version=1' \
      'state=import_prepared' \
      "release=$commit_sha" \
      "source_dev_ino=$source_dev_ino" \
      "binding_sha256=$binding_digest" \
      "identity_hmac_key_sha256=$identity_key_digest" \
      "selector_sha256=$selector_digest" \
      "image_id=$image_id" \
      "profile_volume=$KEMERBET_PROFILE_VOLUME" \
      "session_container=$session_container" \
      "owner_stage_player_ids_dev_ino=$owner_player_ids_dev_ino" \
      "owner_stage_claim_dev_ino=$owner_claim_dev_ino" \
      "claim_id=$claim_id" \
      "player_ids_sha256=$player_ids_digest"
  } | sha256sum | awk '{print $1}')"
  actual_digest="$(sha256sum -- "$KEMERBET_RECHECK_PROMOTION_JOURNAL" | awk '{print $1}')"
  [[ "$actual_digest" == "$expected_digest" ]] ||
    die 'the import-prepared KemerBet promotion journal content is not exact'
}

advance_kemerbet_recheck_import_journal_to_prepared() {
  local commit_sha="$1" source_dev_ino="$2" binding_digest="$3"
  local identity_key_digest="$4" selector_digest="$5" image_id="$6"
  local session_container="$7" player_ids_dev_ino="$8"
  local owner_player_ids_dev_ino="$9" owner_claim_dev_ino="${10}" claim_id="${11}"
  local player_ids_digest="${12}"
  local temporary
  require_kemerbet_recheck_import_prepared_promotion_journal \
    "$commit_sha" "$source_dev_ino" "$binding_digest" "$identity_key_digest" \
    "$selector_digest" "$image_id" "$session_container" \
    "$owner_player_ids_dev_ino" "$owner_claim_dev_ino" "$claim_id" "$player_ids_digest"
  [[ "$player_ids_dev_ino" =~ ^[0-9]+:[0-9]+$ ]] ||
    die 'the prepared KemerBet Player-ID identity is invalid'
  temporary="$(mktemp "$KEMERBET_RECHECK_PROMOTION_ROOT/.pending-v1.XXXXXX")" ||
    die 'the prepared KemerBet promotion journal could not be prepared'
  if ! printf '%s\n' \
    'version=1' \
    'state=prepared' \
    "release=$commit_sha" \
    "source_dev_ino=$source_dev_ino" \
    "binding_sha256=$binding_digest" \
    "identity_hmac_key_sha256=$identity_key_digest" \
    "selector_sha256=$selector_digest" \
    "image_id=$image_id" \
    "profile_volume=$KEMERBET_PROFILE_VOLUME" \
    "session_container=$session_container" \
    "player_ids_dev_ino=$player_ids_dev_ino" \
    "owner_stage_player_ids_dev_ino=$owner_player_ids_dev_ino" \
    "owner_stage_claim_dev_ino=$owner_claim_dev_ino" \
    "claim_id=$claim_id" \
    "player_ids_sha256=$player_ids_digest" >"$temporary"; then
    die 'the prepared KemerBet promotion journal could not be written'
  fi
  chown root:root "$temporary"
  chmod 0600 "$temporary"
  sync -f "$temporary" || die 'the prepared KemerBet promotion journal could not be synchronized'
  mv -f -- "$temporary" "$KEMERBET_RECHECK_PROMOTION_JOURNAL"
  sync -f "$KEMERBET_RECHECK_PROMOTION_ROOT" ||
    die 'the prepared KemerBet promotion-journal root could not be synchronized'
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_JOURNAL" &&
    "$(stat --format='%U:%G:%a:%h' "$KEMERBET_RECHECK_PROMOTION_JOURNAL")" == 'root:root:600:1' ]] ||
    die 'the prepared KemerBet promotion journal is unsafe'
}

advance_kemerbet_recheck_promotion_journal() {
  local commit_sha="$1"
  local source_dev_ino="$2"
  local binding_dev_ino="$3"
  local binding_digest="$4"
  local identity_key_digest="$5"
  local selector_digest="$6"
  local image_id="$7"
  local profile_identity_digest="$8"
  local session_container="$9"
  local player_ids_dev_ino="${10}"
  local owner_player_ids_dev_ino="${11}"
  local owner_claim_dev_ino="${12}"
  local claim_id="${13}"
  local player_ids_digest="${14}"
  local temporary
  require_kemerbet_recheck_prepared_promotion_journal \
    "$commit_sha" "$source_dev_ino" \
    "$binding_digest" "$identity_key_digest" "$selector_digest" "$image_id" \
    "$session_container" "$player_ids_dev_ino" \
    "$owner_player_ids_dev_ino" "$owner_claim_dev_ino" "$claim_id" "$player_ids_digest"
  [[ "$binding_dev_ino" =~ ^[0-9]+:[0-9]+$ && "$profile_identity_digest" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the KemerBet candidate-bound promotion identity is invalid'
  temporary="$(mktemp "$KEMERBET_RECHECK_PROMOTION_ROOT/.pending-v1.XXXXXX")" ||
    die 'the candidate-bound KemerBet promotion journal could not be prepared'
  if ! printf '%s\n' \
    'version=1' \
    'state=candidate_bound' \
    "release=$commit_sha" \
    "source_dev_ino=$source_dev_ino" \
    "binding_dev_ino=$binding_dev_ino" \
    "binding_sha256=$binding_digest" \
    "identity_hmac_key_sha256=$identity_key_digest" \
    "selector_sha256=$selector_digest" \
    "image_id=$image_id" \
    "profile_volume=$KEMERBET_PROFILE_VOLUME" \
    "profile_identity_sha256=$profile_identity_digest" \
    "session_container=$session_container" \
    "player_ids_dev_ino=$player_ids_dev_ino" \
    "owner_stage_player_ids_dev_ino=$owner_player_ids_dev_ino" \
    "owner_stage_claim_dev_ino=$owner_claim_dev_ino" \
    "claim_id=$claim_id" \
    "player_ids_sha256=$player_ids_digest" >"$temporary"; then
    die 'the candidate-bound KemerBet promotion journal could not be written'
  fi
  chown root:root "$temporary"
  chmod 0600 "$temporary"
  sync -f "$temporary" ||
    die 'the candidate-bound KemerBet promotion journal could not be synchronized'
  mv -f -- "$temporary" "$KEMERBET_RECHECK_PROMOTION_JOURNAL"
  sync -f "$KEMERBET_RECHECK_PROMOTION_ROOT" ||
    die 'the candidate-bound KemerBet promotion-journal root could not be synchronized'
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_JOURNAL" &&
    "$(stat --format='%U:%G:%a:%h' "$KEMERBET_RECHECK_PROMOTION_JOURNAL")" == 'root:root:600:1' ]] ||
    die 'the candidate-bound KemerBet promotion journal is unsafe'
}

require_kemerbet_recheck_prepared_promotion_journal() {
  local commit_sha="$1"
  local source_dev_ino="$2"
  local binding_digest="$3"
  local identity_key_digest="$4"
  local selector_digest="$5"
  local image_id="$6"
  local session_container="$7"
  local player_ids_dev_ino="$8"
  local owner_player_ids_dev_ino="$9"
  local owner_claim_dev_ino="${10}"
  local claim_id="${11}"
  local player_ids_digest="${12}"
  local actual_digest entries expected_digest
  [[ "$player_ids_digest" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the prepared KemerBet Player-ID digest is invalid'
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" && -d "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(realpath -- "$KEMERBET_RECHECK_PROMOTION_ROOT")" == "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(stat --format='%U:%G:%a' "$KEMERBET_RECHECK_PROMOTION_ROOT")" == 'root:root:700' ]] ||
    die 'the prepared KemerBet promotion-journal root is unsafe'
  entries="$(find -P "$KEMERBET_RECHECK_PROMOTION_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n')" ||
    die 'the prepared KemerBet promotion-journal root could not be inspected'
  [[ "$entries" == 'pending-v1' ]] || die 'the prepared KemerBet promotion-journal root is not exact'
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_JOURNAL" && -f "$KEMERBET_RECHECK_PROMOTION_JOURNAL" &&
    "$(realpath -- "$KEMERBET_RECHECK_PROMOTION_JOURNAL")" == "$KEMERBET_RECHECK_PROMOTION_JOURNAL" &&
    "$(stat --format='%U:%G:%a:%h' "$KEMERBET_RECHECK_PROMOTION_JOURNAL")" == 'root:root:600:1' ]] ||
    die 'the prepared KemerBet promotion journal is unsafe'
  expected_digest="$({
    printf '%s\n' \
      'version=1' \
      'state=prepared' \
      "release=$commit_sha" \
      "source_dev_ino=$source_dev_ino" \
      "binding_sha256=$binding_digest" \
      "identity_hmac_key_sha256=$identity_key_digest" \
      "selector_sha256=$selector_digest" \
      "image_id=$image_id" \
      "profile_volume=$KEMERBET_PROFILE_VOLUME" \
      "session_container=$session_container" \
      "player_ids_dev_ino=$player_ids_dev_ino" \
      "owner_stage_player_ids_dev_ino=$owner_player_ids_dev_ino" \
      "owner_stage_claim_dev_ino=$owner_claim_dev_ino" \
      "claim_id=$claim_id" \
      "player_ids_sha256=$player_ids_digest"
  } | sha256sum | awk '{print $1}')"
  actual_digest="$(sha256sum -- "$KEMERBET_RECHECK_PROMOTION_JOURNAL" | awk '{print $1}')"
  [[ "$actual_digest" == "$expected_digest" ]] ||
    die 'the prepared KemerBet promotion journal content is not exact'
}

require_kemerbet_recheck_promotion_journal() {
  local commit_sha="$1"
  local source_dev_ino="$2"
  local binding_dev_ino="$3"
  local binding_digest="$4"
  local identity_key_digest="$5"
  local selector_digest="$6"
  local image_id="$7"
  local profile_identity_digest="$8"
  local session_container="$9"
  local player_ids_dev_ino="${10}"
  local owner_player_ids_dev_ino="${11}"
  local owner_claim_dev_ino="${12}"
  local claim_id="${13}"
  local player_ids_digest="${14}"
  local actual_digest entries expected_digest
  [[ "$source_dev_ino" =~ ^[0-9]+:[0-9]+$ && "$binding_dev_ino" =~ ^[0-9]+:[0-9]+$ &&
    "$player_ids_digest" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the KemerBet promotion journal file identity is invalid'
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" && -d "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(realpath -- "$KEMERBET_RECHECK_PROMOTION_ROOT")" == "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(stat --format='%U:%G:%a' "$KEMERBET_RECHECK_PROMOTION_ROOT")" == 'root:root:700' ]] ||
    die 'the KemerBet promotion-journal root is unsafe'
  entries="$(find -P "$KEMERBET_RECHECK_PROMOTION_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n')" ||
    die 'the KemerBet promotion-journal root could not be inspected'
  [[ "$entries" == 'pending-v1' ]] || die 'the KemerBet promotion-journal root is not exact'
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_JOURNAL" && -f "$KEMERBET_RECHECK_PROMOTION_JOURNAL" &&
    "$(realpath -- "$KEMERBET_RECHECK_PROMOTION_JOURNAL")" == "$KEMERBET_RECHECK_PROMOTION_JOURNAL" &&
    "$(stat --format='%U:%G:%a:%h' "$KEMERBET_RECHECK_PROMOTION_JOURNAL")" == 'root:root:600:1' ]] ||
    die 'the KemerBet promotion journal is unsafe'
  expected_digest="$({
    printf '%s\n' \
      'version=1' \
      'state=candidate_bound' \
      "release=$commit_sha" \
      "source_dev_ino=$source_dev_ino" \
      "binding_dev_ino=$binding_dev_ino" \
      "binding_sha256=$binding_digest" \
      "identity_hmac_key_sha256=$identity_key_digest" \
      "selector_sha256=$selector_digest" \
      "image_id=$image_id" \
      "profile_volume=$KEMERBET_PROFILE_VOLUME" \
      "profile_identity_sha256=$profile_identity_digest" \
      "session_container=$session_container" \
      "player_ids_dev_ino=$player_ids_dev_ino" \
      "owner_stage_player_ids_dev_ino=$owner_player_ids_dev_ino" \
      "owner_stage_claim_dev_ino=$owner_claim_dev_ino" \
      "claim_id=$claim_id" \
      "player_ids_sha256=$player_ids_digest"
  } | sha256sum | awk '{print $1}')"
  actual_digest="$(sha256sum -- "$KEMERBET_RECHECK_PROMOTION_JOURNAL" | awk '{print $1}')"
  [[ "$actual_digest" == "$expected_digest" ]] ||
    die 'the KemerBet promotion journal content is not exact'
}

require_committed_kemerbet_recheck_boundary_shape() {
  local binding_digest entries
  local -a receipt_lines=()
  [[ ! -L "$KEMERBET_RECHECK_RECEIPT_ROOT" && -d "$KEMERBET_RECHECK_RECEIPT_ROOT" &&
    "$(realpath -- "$KEMERBET_RECHECK_RECEIPT_ROOT")" == "$KEMERBET_RECHECK_RECEIPT_ROOT" &&
    "$(stat --format='%U:%G:%a' "$KEMERBET_RECHECK_RECEIPT_ROOT")" == 'root:root:700' ]] ||
    die 'an interrupted committed KemerBet receipt root is unsafe'
  entries="$(find -P "$KEMERBET_RECHECK_RECEIPT_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n')" ||
    die 'an interrupted committed KemerBet receipt root could not be inspected'
  [[ "$entries" == 'ready-v1' ]] || die 'an interrupted committed KemerBet receipt root is not exact'
  [[ ! -L "$KEMERBET_RECHECK_RECEIPT" && -f "$KEMERBET_RECHECK_RECEIPT" &&
    "$(realpath -- "$KEMERBET_RECHECK_RECEIPT")" == "$KEMERBET_RECHECK_RECEIPT" &&
    "$(stat --format='%U:%G:%a:%h' "$KEMERBET_RECHECK_RECEIPT")" == 'root:root:600:1' ]] ||
    die 'an interrupted committed KemerBet receipt is unsafe'
  mapfile -t receipt_lines <"$KEMERBET_RECHECK_RECEIPT"
  [[ "${#receipt_lines[@]}" -eq 8 &&
    "${receipt_lines[0]}" == 'version=1' &&
    "${receipt_lines[1]}" =~ ^release=[0-9a-f]{40}$ &&
    "${receipt_lines[2]}" =~ ^binding_sha256=[0-9a-f]{64}$ &&
    "${receipt_lines[3]}" =~ ^identity_hmac_key_sha256=[0-9a-f]{64}$ &&
    "${receipt_lines[4]}" =~ ^selector_sha256=[0-9a-f]{64}$ &&
    "${receipt_lines[5]}" =~ ^image_id=sha256:[0-9a-f]{64}$ &&
    "${receipt_lines[6]}" == "profile_volume=$KEMERBET_PROFILE_VOLUME" &&
    "${receipt_lines[7]}" =~ ^profile_identity_sha256=[0-9a-f]{64}$ ]] ||
    die 'an interrupted committed KemerBet receipt content is invalid'
  binding_digest="${receipt_lines[2]#binding_sha256=}"
  require_root_readable_immutable_file "$KEMERBET_AGENT_IDENTITY_BINDINGS" || return 1
  [[ "$(stat --format='%h:%s' "$KEMERBET_AGENT_IDENTITY_BINDINGS")" == '1:230' &&
    "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_BINDINGS" | awk '{print $1}')" == "$binding_digest" ]] ||
    die 'an interrupted committed KemerBet binding does not match its receipt'
}

require_current_kemerbet_success_runtime_boundary() {
  local commit_sha="$1" binding_digest="$2" identity_key_digest="$3"
  local selector_digest="$4" image_id="$5" profile_identity_digest="$6"
  local receipt_policy="$7"
  local account_id binding_fingerprint binding_line binding_residue observed_profile_identity_digest
  local agent_profile_pin
  local profile_mountpoint
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ && "$binding_digest" =~ ^[0-9a-f]{64}$ &&
    "$identity_key_digest" =~ ^[0-9a-f]{64}$ && "$selector_digest" =~ ^[0-9a-f]{64}$ &&
    "$image_id" =~ ^sha256:[0-9a-f]{64}$ && "$profile_identity_digest" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the committed KemerBet runtime boundary identity is invalid'
  case "$receipt_policy" in
    require-absent-receipt)
      [[ ! -e "$KEMERBET_RECHECK_RECEIPT_ROOT" && ! -L "$KEMERBET_RECHECK_RECEIPT_ROOT" ]] ||
        die 'the precommit KemerBet receipt boundary is not empty'
      ;;
    require-receipt)
      require_kemerbet_recheck_receipt \
        "$commit_sha" "$binding_digest" "$identity_key_digest" "$selector_digest" \
        "$image_id" "$profile_identity_digest"
      ;;
    *) die 'the committed KemerBet receipt policy is invalid' ;;
  esac
  require_root_readable_immutable_file "$KEMERBET_AGENT_IDENTITY_BINDINGS"
  require_root_readable_immutable_file "$KEMERBET_AGENT_IDENTITY_HMAC_KEY"
  require_root_readable_immutable_file "$KEMERBET_SELECTOR_CONTRACT"
  [[ "$(stat --format='%h:%s' "$KEMERBET_AGENT_IDENTITY_BINDINGS")" =~ ^(1|2):230$ &&
    "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_BINDINGS" | awk '{print $1}')" == "$binding_digest" &&
    "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" == "$identity_key_digest" &&
    "$(sha256sum -- "$KEMERBET_SELECTOR_CONTRACT" | awk '{print $1}')" == "$selector_digest" ]] ||
    die 'the committed KemerBet runtime input digest changed'
  [[ "$(stat --format='%s' "$KEMERBET_AGENT_IDENTITY_BINDINGS")" == '230' &&
    "$(wc -l <"$KEMERBET_AGENT_IDENTITY_BINDINGS")" == '1' ]] ||
    die 'the committed KemerBet binding shape is invalid'
  require_kemerbet_v3_binding_content "$KEMERBET_AGENT_IDENTITY_BINDINGS" ||
    die 'the committed KemerBet v3 binding contract is invalid'
  binding_line="$(<"$KEMERBET_AGENT_IDENTITY_BINDINGS")"
  IFS=' ' read -r account_id binding_fingerprint agent_profile_pin binding_residue \
    <<<"$binding_line"
  [[ -n "$account_id" && -n "$binding_fingerprint" &&
    -n "$agent_profile_pin" && -z "$binding_residue" ]] ||
    die 'the committed KemerBet binding fields are invalid'
  profile_mountpoint="$(resolve_kemerbet_profile_volume_mountpoint)" || return 1
  observed_profile_identity_digest="$(kemerbet_profile_identity_digest \
    "$account_id" "$profile_mountpoint" require-absent-singletons)" || return 1
  [[ "$observed_profile_identity_digest" == "$profile_identity_digest" ]] ||
    die 'the committed KemerBet profile identity changed'
  [[ "$(docker_local image inspect "$image_id" \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}|{{ index .Config.Labels "org.opencontainers.image.title" }}|{{.Config.User}}')" == \
    "$commit_sha|fetanagent-deposit-executor|10001:10001" ]] ||
    die 'the committed KemerBet image provenance is invalid'
  require_exact_fresh_bot_runtime "$commit_sha" published-steady-state
  require_owner_kemerbet_receipt_service_access
  require_kemerbet_profile_volume_holders ''
  require_kemerbet_recheck_transients_absent ||
    die 'the committed KemerBet recheck retained a container, network, or RPC capability'
}

require_precommit_kemerbet_artifact_boundary() {
  local source_dev_ino="$1" binding_dev_ino="$2" binding_digest="$3"
  local player_ids_dev_ino="$4" player_ids_digest="$5" control_mountpoint claim_path player_path
  [[ "$source_dev_ino" =~ ^[0-9]+:[0-9]+$ && "$binding_dev_ino" =~ ^[0-9]+:[0-9]+$ &&
    "$binding_digest" =~ ^[0-9a-f]{64}$ && "$player_ids_dev_ino" =~ ^[0-9]+:[0-9]+$ &&
    "$player_ids_digest" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the precommit KemerBet artifact identity is invalid'
  require_retryable_kemerbet_binding_source "$source_dev_ino" "$binding_digest" ||
    die 'the precommit sealed KemerBet binding source is not exact'
  require_root_readable_immutable_file "$KEMERBET_READINESS_PLAYER_IDS"
  [[ "$(stat --format='%d:%i:%h' "$KEMERBET_READINESS_PLAYER_IDS")" == "$player_ids_dev_ino:1" &&
    "$(sha256sum -- "$KEMERBET_READINESS_PLAYER_IDS" | awk '{print $1}')" == "$player_ids_digest" ]] ||
    die 'the precommit KemerBet Player-ID input is not journal-exact'
  require_root_readable_immutable_file "$KEMERBET_RECHECK_CANDIDATE_BINDING"
  require_root_readable_immutable_file "$KEMERBET_AGENT_IDENTITY_BINDINGS"
  [[ "$(stat --format='%d:%i:%h:%s' "$KEMERBET_RECHECK_CANDIDATE_BINDING")" == \
      "$binding_dev_ino:2:230" &&
    "$(stat --format='%d:%i:%h:%s' "$KEMERBET_AGENT_IDENTITY_BINDINGS")" == \
      "$binding_dev_ino:2:230" &&
    "$(sha256sum -- "$KEMERBET_RECHECK_CANDIDATE_BINDING" | awk '{print $1}')" == "$binding_digest" &&
    "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_BINDINGS" | awk '{print $1}')" == "$binding_digest" ]] ||
    die 'the precommit canonical KemerBet binding is not journal-exact'
  control_mountpoint="$(resolve_kemerbet_session_control_volume_mountpoint)"
  player_path="$control_mountpoint/$KEMERBET_OWNER_STAGED_PLAYER_IDS_NAME"
  claim_path="$control_mountpoint/$KEMERBET_OWNER_STAGED_CLAIM_NAME"
  [[ ! -L "$player_path" && -f "$player_path" &&
    "$(stat --format='%d:%i:%u:%g:%a:%h' "$player_path")" == \
    "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO:0:0:444:1" &&
    "$(sha256sum -- "$player_path" | awk '{print $1}')" == "$player_ids_digest" &&
    ! -L "$claim_path" && -f "$claim_path" &&
    "$(stat --format='%d:%i:%u:%g:%a:%h:%s' "$claim_path")" == \
    "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO:0:0:444:1:37" ]] ||
    die 'the precommit Owner KemerBet cohort pair is not journal-exact'
  cmp -s -- "$claim_path" <(printf '%s\n' "$KEMERBET_RECHECK_OWNER_CLAIM_ID") ||
    die 'the precommit Owner KemerBet claim changed'
  owner_kemerbet_cohort_marker require-imported "$KEMERBET_RECHECK_OWNER_CLAIM_ID" ||
    die 'the precommit Owner KemerBet imported marker is not exact'
}

require_committed_kemerbet_cleanup_artifacts() {
  local source_dev_ino="$1" binding_dev_ino="$2" binding_digest="$3"
  local player_ids_dev_ino="$4" player_ids_digest="$5" canonical_links
  canonical_links="$(stat --format='%h' "$KEMERBET_AGENT_IDENTITY_BINDINGS")" ||
    die 'the committed canonical KemerBet binding link count is unavailable'
  if [[ -e "$KEMERBET_RECHECK_CANDIDATE_BINDING" || -L "$KEMERBET_RECHECK_CANDIDATE_BINDING" ]]; then
    [[ "$canonical_links" == '2' && ! -L "$KEMERBET_RECHECK_CANDIDATE_BINDING" &&
      "$(stat --format='%d:%i:%u:%g:%a:%h:%s' "$KEMERBET_RECHECK_CANDIDATE_BINDING")" == \
      "$binding_dev_ino:0:0:444:2:230" &&
      "$(stat --format='%d:%i:%h:%s' "$KEMERBET_AGENT_IDENTITY_BINDINGS")" == \
      "$binding_dev_ino:2:230" &&
      "$(sha256sum -- "$KEMERBET_RECHECK_CANDIDATE_BINDING" | awk '{print $1}')" == "$binding_digest" ]] ||
      die 'the committed KemerBet candidate cleanup prefix is unsafe'
  else
    [[ "$canonical_links" == '1' &&
      "$(stat --format='%d:%i:%s' "$KEMERBET_AGENT_IDENTITY_BINDINGS")" == \
        "$binding_dev_ino:230" ]] ||
      die 'the committed canonical KemerBet binding identity is unsafe'
  fi
  if [[ -e "$KEMERBET_READINESS_BINDING" || -L "$KEMERBET_READINESS_BINDING" ]]; then
    require_retryable_kemerbet_binding_source "$source_dev_ino" "$binding_digest" ||
      die 'the committed sealed KemerBet binding cleanup prefix is unsafe'
  fi
  if [[ -e "$KEMERBET_READINESS_PLAYER_IDS" || -L "$KEMERBET_READINESS_PLAYER_IDS" ]]; then
    [[ ! -L "$KEMERBET_READINESS_PLAYER_IDS" &&
      "$(stat --format='%d:%i:%u:%g:%a:%h' "$KEMERBET_READINESS_PLAYER_IDS")" == \
      "$player_ids_dev_ino:0:0:444:1" &&
      "$(sha256sum -- "$KEMERBET_READINESS_PLAYER_IDS" | awk '{print $1}')" == "$player_ids_digest" ]] ||
      die 'the committed KemerBet Player-ID cleanup prefix is unsafe'
  fi
}

require_completed_kemerbet_recheck_for_release() {
  local commit_sha="$1" image_tag="$2"
  local account_id binding_digest binding_fingerprint binding_line binding_residue
  local identity_key_digest image_id observed_profile_identity_digest profile_identity_digest
  local profile_mountpoint agent_profile_pin selector_digest
  local -a receipt_lines=()
  validate_commit_and_tag "$commit_sha" "$image_tag"
  [[ ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" ]] ||
    die 'a completed KemerBet recheck still has a promotion journal'
  require_completed_owner_kemerbet_cohort_marker
  require_committed_kemerbet_recheck_boundary_shape
  mapfile -t receipt_lines <"$KEMERBET_RECHECK_RECEIPT"
  [[ "${receipt_lines[1]}" == "release=$commit_sha" ]] ||
    die 'the completed KemerBet recheck belongs to another reviewed release'
  binding_digest="${receipt_lines[2]#binding_sha256=}"
  identity_key_digest="${receipt_lines[3]#identity_hmac_key_sha256=}"
  selector_digest="${receipt_lines[4]#selector_sha256=}"
  image_id="${receipt_lines[5]#image_id=}"
  profile_identity_digest="${receipt_lines[7]#profile_identity_sha256=}"
  require_kemerbet_recheck_receipt \
    "$commit_sha" "$binding_digest" "$identity_key_digest" "$selector_digest" \
    "$image_id" "$profile_identity_digest"
  require_root_readable_immutable_file "$KEMERBET_AGENT_IDENTITY_BINDINGS"
  require_root_readable_immutable_file "$KEMERBET_AGENT_IDENTITY_HMAC_KEY"
  require_root_readable_immutable_file "$KEMERBET_SELECTOR_CONTRACT"
  [[ "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_BINDINGS" | awk '{print $1}')" == "$binding_digest" &&
    "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" == "$identity_key_digest" &&
    "$(sha256sum -- "$KEMERBET_SELECTOR_CONTRACT" | awk '{print $1}')" == "$selector_digest" ]] ||
    die 'a completed KemerBet recheck digest no longer matches its receipt'
  [[ "$(stat --format='%s' "$KEMERBET_AGENT_IDENTITY_BINDINGS")" == '230' &&
    "$(wc -l <"$KEMERBET_AGENT_IDENTITY_BINDINGS")" == '1' ]] ||
    die 'the completed KemerBet binding shape is invalid'
  require_kemerbet_v3_binding_content "$KEMERBET_AGENT_IDENTITY_BINDINGS" ||
    die 'the completed KemerBet v3 binding contract is invalid'
  binding_line="$(<"$KEMERBET_AGENT_IDENTITY_BINDINGS")"
  IFS=' ' read -r account_id binding_fingerprint agent_profile_pin binding_residue \
    <<<"$binding_line"
  [[ -n "$account_id" && -n "$binding_fingerprint" &&
    -n "$agent_profile_pin" && -z "$binding_residue" ]] ||
    die 'the completed KemerBet binding fields are invalid'
  profile_mountpoint="$(resolve_kemerbet_profile_volume_mountpoint)" || return 1
  observed_profile_identity_digest="$(kemerbet_profile_identity_digest \
    "$account_id" "$profile_mountpoint" require-absent-singletons)" || return 1
  [[ "$observed_profile_identity_digest" == "$profile_identity_digest" ]] ||
    die 'the completed KemerBet profile identity changed'
  [[ "$(docker_local image inspect "fetanagent-deposit-executor:$image_tag" --format '{{.Id}}')" == \
    "$image_id" ]] || die 'the completed KemerBet image identity is unavailable or changed'
  [[ "$(docker_local image inspect "$image_id" \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}|{{ index .Config.Labels "org.opencontainers.image.title" }}|{{.Config.User}}')" == \
    "$commit_sha|fetanagent-deposit-executor|10001:10001" ]] ||
    die 'the completed KemerBet image provenance is invalid'
  require_exact_fresh_bot_runtime "$commit_sha" published-steady-state
  require_owner_kemerbet_receipt_service_access
  require_kemerbet_profile_volume_holders ''
  require_kemerbet_recheck_transients_absent ||
    die 'the completed KemerBet recheck retained a container, network, or RPC capability'
  [[ ! -e "$KEMERBET_READINESS_PLAYER_IDS" && ! -L "$KEMERBET_READINESS_PLAYER_IDS" &&
    ! -e "$KEMERBET_RECHECK_CANDIDATE_ROOT" && ! -L "$KEMERBET_RECHECK_CANDIDATE_ROOT" &&
    ! -e "$KEMERBET_READINESS_BINDING" && ! -L "$KEMERBET_READINESS_BINDING" ]] ||
    die 'a completed KemerBet recheck retained a consumed input'
  require_kemerbet_readiness_output_directory
}

remove_exact_kemerbet_session_provision() {
  local expected_container="$1" commit_sha="$2"
  local actual_container environment mount_source state
  [[ "$expected_container" == 'none' || "$expected_container" =~ ^[0-9a-f]{12,64}$ ]] || return 1
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || return 1
  actual_container="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter 'label=com.docker.compose.service=kemerbet-session-provision')" || return 1
  if [[ "$expected_container" == 'none' ]]; then
    [[ -z "$actual_container" ]]
    return $?
  fi
  if [[ -z "$actual_container" ]]; then
    return 0
  fi
  [[ "$actual_container" == "$expected_container" ]] || return 1
  [[ "$(docker_local container inspect "$actual_container" \
    --format '{{ index .Config.Labels "com.docker.compose.project" }}|{{ index .Config.Labels "com.docker.compose.service" }}|{{ index .Config.Labels "org.opencontainers.image.revision" }}|{{.Config.User}}|{{json .Config.Cmd}}')" == \
    "$PROJECT_NAME|kemerbet-session-provision|$commit_sha|10001:10001|[\"node\",\"apps/executor/dist/kemerbet-session-provision-server.js\"]" ]] || return 1
  environment="$(docker_local container inspect "$actual_container" \
    --format '{{range .Config.Env}}{{println .}}{{end}}')" || return 1
  for expected_environment in \
    'NODE_ENV=production' \
    'FINANCIAL_ACTIONS_MODE=dry_run' \
    'KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED=true' \
    'KEMERBET_EXECUTOR_ENABLED=false' \
    'KEMERBET_FINAL_ACTION_ENABLED=false' \
    'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=false' \
    'INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED=false'; do
    grep -Fxq "$expected_environment" <<<"$environment" || return 1
  done
  ! grep -Eq '(DATABASE|PASSWORD|SECRET|TOKEN|HMAC|SUPABASE|PLAYER|RECEIVER|SELECTOR|IDENTITY)' \
    <<<"$environment" || return 1
  mount_source="$(docker_local container inspect "$actual_container" \
    --format '{{range .Mounts}}{{if eq .Destination "/var/lib/fetanagent/kemerbet-sessions"}}{{.Name}}{{end}}{{end}}')" || return 1
  [[ "$mount_source" == "$KEMERBET_PROFILE_VOLUME" ]] || return 1
  state="$(docker_local container inspect "$actual_container" --format '{{.State.Status}}')" || return 1
  case "$state" in
    running) docker_local container stop --time 70 "$actual_container" >/dev/null || return 1 ;;
    exited) ;;
    *) return 1 ;;
  esac
  docker_local container rm "$actual_container" >/dev/null || return 1
  actual_container="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter 'label=com.docker.compose.service=kemerbet-session-provision')" || return 1
  [[ -z "$actual_container" ]]
}

remove_journaled_kemerbet_session_provision() {
  remove_exact_kemerbet_session_provision "$1" "$2" ||
    die 'the journaled KemerBet session could not be removed safely'
}

inspect_kemerbet_recovery_latch() {
  local ancestor latch_path='' path present_count=0
  for ancestor in / /var /var/lib; do
    [[ ! -L "$ancestor" && -d "$ancestor" && "$(realpath -- "$ancestor" 2>/dev/null)" == "$ancestor" &&
      "$(stat --format='%u:%g:%a' "$ancestor" 2>/dev/null)" == '0:0:755' ]] || return 2
  done
  if [[ ! -e "$KEMERBET_OWNER_RECEIPT_PARENT" && ! -L "$KEMERBET_OWNER_RECEIPT_PARENT" ]]; then
    [[ ! -e "$KEMERBET_OWNER_RECEIPT_ROOT" && ! -L "$KEMERBET_OWNER_RECEIPT_ROOT" ]] || return 2
    return 1
  fi
  [[ ! -L "$KEMERBET_OWNER_RECEIPT_PARENT" && -d "$KEMERBET_OWNER_RECEIPT_PARENT" &&
    "$(realpath -- "$KEMERBET_OWNER_RECEIPT_PARENT" 2>/dev/null)" == "$KEMERBET_OWNER_RECEIPT_PARENT" &&
    "$(stat --format='%u:%g:%a' "$KEMERBET_OWNER_RECEIPT_PARENT" 2>/dev/null)" == '0:0:755' ]] || return 2
  if [[ ! -e "$KEMERBET_OWNER_RECEIPT_ROOT" && ! -L "$KEMERBET_OWNER_RECEIPT_ROOT" ]]; then
    return 1
  fi
  [[ ! -L "$KEMERBET_OWNER_RECEIPT_ROOT" && -d "$KEMERBET_OWNER_RECEIPT_ROOT" &&
    "$(realpath -- "$KEMERBET_OWNER_RECEIPT_ROOT" 2>/dev/null)" == "$KEMERBET_OWNER_RECEIPT_ROOT" &&
    "$(stat --format='%u:%g:%a' "$KEMERBET_OWNER_RECEIPT_ROOT" 2>/dev/null)" == '0:0:755' ]] || return 2
  for path in \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME"; do
    if [[ -e "$path" || -L "$path" ]]; then
      present_count=$((present_count + 1))
      latch_path="$path"
    fi
  done
  [[ "$present_count" -ne 0 ]] || return 1
  [[ "$present_count" -eq 1 && ! -L "$latch_path" && -f "$latch_path" &&
    "$(realpath -- "$latch_path" 2>/dev/null)" == "$latch_path" &&
    "$(stat --format='%u:%g:%a:%h' "$latch_path" 2>/dev/null)" == '0:0:400:1' ]] || return 2
  cmp -s -- "$latch_path" \
    <(printf '%s\n' 'fetanagent-kemerbet-readiness-recovery-in-progress-or-failed-v1') || return 2
  return 0
}

inspect_kemerbet_recovery_fallback() {
  local fallback_path='' path present_count=0
  if [[ ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" ]]; then
    return 1
  fi
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" && -d "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(realpath -- "$KEMERBET_RECHECK_PROMOTION_ROOT" 2>/dev/null)" == "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(stat --format='%u:%g:%a' "$KEMERBET_RECHECK_PROMOTION_ROOT" 2>/dev/null)" == '0:0:700' ]] || return 2
  for path in \
    "$KEMERBET_RECHECK_PROMOTION_ROOT/$KEMERBET_RECOVERY_FALLBACK_NAME" \
    "$KEMERBET_RECHECK_PROMOTION_ROOT/$KEMERBET_RECOVERY_FALLBACK_INSTALLING_NAME"; do
    if [[ -e "$path" || -L "$path" ]]; then
      present_count=$((present_count + 1))
      fallback_path="$path"
    fi
  done
  [[ "$present_count" -ne 0 ]] || return 1
  [[ "$present_count" -eq 1 && ! -L "$fallback_path" && -f "$fallback_path" &&
    "$(realpath -- "$fallback_path" 2>/dev/null)" == "$fallback_path" &&
    "$(stat --format='%u:%g:%a:%h' "$fallback_path" 2>/dev/null)" == '0:0:400:1' ]] || return 2
  cmp -s -- "$fallback_path" \
    <(printf '%s\n' 'fetanagent-kemerbet-readiness-recovery-in-progress-or-failed-v1') || return 2
  return 0
}

durably_retain_fixed_kemerbet_recovery_residue() {
  local policy="$1" root="$2" final_name="$3" installing_name="$4"
  [[ "$policy" =~ ^(receipt|promotion)$ && "$root" == /* && "$final_name" != */* &&
    "$installing_name" != */* ]] || return 1
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$policy" "$root" "$final_name" "$installing_name" \
    "$(basename -- "$KEMERBET_RECHECK_PROMOTION_JOURNAL")" <<'PY'
import os
import stat
import sys

CONTENT = b"fetanagent-kemerbet-readiness-recovery-in-progress-or-failed-v1\n"
RECEIPT_MARKERS = {
    'kemerbet-readiness-cohort-imported-v1',
    '.kemerbet-readiness-cohort-imported-v1.installing',
    'kemerbet-readiness-cohort-completed-v1',
    '.kemerbet-readiness-cohort-completed-v1.installing',
    'kemerbet-readiness-cohort-failed-v1',
    '.kemerbet-readiness-cohort-failed-v1.installing',
}


def reject():
    raise RuntimeError


def same(first, second):
    return (
        first.st_dev == second.st_dev
        and first.st_ino == second.st_ino
        and first.st_mode == second.st_mode
        and first.st_uid == second.st_uid
        and first.st_gid == second.st_gid
        and first.st_nlink == second.st_nlink
        and first.st_size == second.st_size
    )


def open_exact(root_fd, name, expected_mode, maximum_size, expected_content=None):
    named = os.stat(name, dir_fd=root_fd, follow_symlinks=False)
    if (
        not stat.S_ISREG(named.st_mode)
        or named.st_uid != 0
        or named.st_gid != 0
        or stat.S_IMODE(named.st_mode) != expected_mode
        or named.st_nlink != 1
        or not 0 <= named.st_size <= maximum_size
    ):
        reject()
    descriptor = os.open(
        name,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=root_fd,
    )
    opened = os.fstat(descriptor)
    content = os.pread(descriptor, maximum_size + 1, 0)
    if not same(named, opened) or len(content) != named.st_size:
        os.close(descriptor)
        reject()
    if expected_content is not None and content != expected_content:
        os.close(descriptor)
        reject()
    return descriptor, opened, content


def main():
    policy, root, final_name, installing_name, journal_name = sys.argv[1:]
    if policy not in {'receipt', 'promotion'}:
        reject()
    root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    residue_fd = None
    journal_fd = None
    try:
        root_stat = os.fstat(root_fd)
        expected_root_mode = 0o755 if policy == 'receipt' else 0o700
        if (
            not stat.S_ISDIR(root_stat.st_mode)
            or root_stat.st_uid != 0
            or root_stat.st_gid != 0
            or stat.S_IMODE(root_stat.st_mode) != expected_root_mode
        ):
            reject()
        names = set(os.listdir(root_fd))
        residue_names = names & {final_name, installing_name}
        if len(residue_names) != 1:
            reject()
        residue_name = next(iter(residue_names))
        if policy == 'receipt':
            if names - RECEIPT_MARKERS - {residue_name}:
                reject()
        else:
            if names != {journal_name, residue_name}:
                reject()
            journal_fd, journal_stat, journal_content = open_exact(
                root_fd,
                journal_name,
                0o600,
                4096,
            )
            journal_lines = journal_content.splitlines()
            if (
                journal_stat.st_size < 1
                or len(journal_lines) < 2
                or journal_lines[0] != b'version=1'
                or journal_lines[1]
                not in {
                    b'state=import_prepared',
                    b'state=prepared',
                    b'state=candidate_bound',
                }
            ):
                reject()
        residue_fd, residue_stat, residue_content = open_exact(
            root_fd,
            residue_name,
            0o400,
            len(CONTENT),
        )
        if not CONTENT.startswith(residue_content):
            reject()
        os.fsync(residue_fd)
        if journal_fd is not None:
            os.fsync(journal_fd)
        os.fsync(root_fd)
        named_root = os.lstat(root)
        if not same(root_stat, named_root) or os.path.realpath(root) != root:
            reject()
        named_residue = os.stat(residue_name, dir_fd=root_fd, follow_symlinks=False)
        if (
            not same(residue_stat, named_residue)
            or os.pread(residue_fd, len(CONTENT) + 1, 0) != residue_content
        ):
            reject()
        if journal_fd is not None:
            named_journal = os.stat(journal_name, dir_fd=root_fd, follow_symlinks=False)
            if (
                not same(journal_stat, named_journal)
                or os.pread(journal_fd, 4097, 0) != journal_content
            ):
                reject()
    finally:
        if journal_fd is not None:
            os.close(journal_fd)
        if residue_fd is not None:
            os.close(residue_fd)
        os.close(root_fd)


try:
    if len(sys.argv) != 6:
        reject()
    main()
except BaseException:
    raise SystemExit(1)
PY
}

durably_retain_kemerbet_recovery_latch_residue() {
  local ancestor
  for ancestor in / /var /var/lib "$KEMERBET_OWNER_RECEIPT_PARENT" "$KEMERBET_OWNER_RECEIPT_ROOT"; do
    [[ ! -L "$ancestor" && -d "$ancestor" && "$(realpath -- "$ancestor" 2>/dev/null)" == "$ancestor" &&
      "$(stat --format='%u:%g:%a' "$ancestor" 2>/dev/null)" == '0:0:755' ]] || return 1
  done
  durably_retain_fixed_kemerbet_recovery_residue \
    receipt "$KEMERBET_OWNER_RECEIPT_ROOT" \
    "$KEMERBET_RECOVERY_LATCH_NAME" "$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME"
}

durably_retain_kemerbet_recovery_fallback_residue() {
  local ancestor
  for ancestor in / /var /var/lib "$KEMERBET_OWNER_RECEIPT_PARENT"; do
    [[ ! -L "$ancestor" && -d "$ancestor" && "$(realpath -- "$ancestor" 2>/dev/null)" == "$ancestor" &&
      "$(stat --format='%u:%g:%a' "$ancestor" 2>/dev/null)" == '0:0:755' ]] || return 1
  done
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" && -d "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(realpath -- "$KEMERBET_RECHECK_PROMOTION_ROOT" 2>/dev/null)" == "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(stat --format='%u:%g:%a' "$KEMERBET_RECHECK_PROMOTION_ROOT" 2>/dev/null)" == '0:0:700' ]] ||
    return 1
  durably_retain_fixed_kemerbet_recovery_residue \
    promotion "$KEMERBET_RECHECK_PROMOTION_ROOT" \
    "$KEMERBET_RECOVERY_FALLBACK_NAME" "$KEMERBET_RECOVERY_FALLBACK_INSTALLING_NAME"
}

require_kemerbet_recovery_fallback_publish_boundary() {
  local entries journal_size
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" && -d "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(realpath -- "$KEMERBET_RECHECK_PROMOTION_ROOT" 2>/dev/null)" == "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(stat --format='%u:%g:%a' "$KEMERBET_RECHECK_PROMOTION_ROOT" 2>/dev/null)" == '0:0:700' ]] ||
    return 1
  entries="$(find -P "$KEMERBET_RECHECK_PROMOTION_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n')" ||
    return 1
  [[ "$entries" == 'pending-v1' ]] || return 1
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_JOURNAL" && -f "$KEMERBET_RECHECK_PROMOTION_JOURNAL" &&
    "$(realpath -- "$KEMERBET_RECHECK_PROMOTION_JOURNAL" 2>/dev/null)" == "$KEMERBET_RECHECK_PROMOTION_JOURNAL" &&
    "$(stat --format='%u:%g:%a:%h' "$KEMERBET_RECHECK_PROMOTION_JOURNAL" 2>/dev/null)" == '0:0:600:1' ]] ||
    return 1
  journal_size="$(stat --format='%s' "$KEMERBET_RECHECK_PROMOTION_JOURNAL" 2>/dev/null)" || return 1
  [[ "$journal_size" =~ ^[0-9]+$ && "$journal_size" -ge 1 && "$journal_size" -le 4096 ]] || return 1
  [[ "$(sed -n '1p' "$KEMERBET_RECHECK_PROMOTION_JOURNAL")" == 'version=1' &&
    "$(sed -n '2p' "$KEMERBET_RECHECK_PROMOTION_JOURNAL")" =~ ^state=(import_prepared|prepared|candidate_bound)$ ]] ||
    return 1
}

publish_kemerbet_recovery_fallback() {
  local fallback_status=0 publisher_status=0
  set +e
  inspect_kemerbet_recovery_fallback
  fallback_status=$?
  set -e
  [[ "$fallback_status" -eq 1 ]] || return 1
  require_kemerbet_recovery_fallback_publish_boundary || return 1
  set +e
  (
    set -e
    env -i PATH="$SAFE_PATH" python3 -I - \
      "$KEMERBET_RECHECK_PROMOTION_ROOT" "$(basename -- "$KEMERBET_RECHECK_PROMOTION_JOURNAL")" \
      "$KEMERBET_RECOVERY_FALLBACK_NAME" "$KEMERBET_RECOVERY_FALLBACK_INSTALLING_NAME" <<'PY'
import os
import stat
import sys

CONTENT = b"fetanagent-kemerbet-readiness-recovery-in-progress-or-failed-v1\n"


def main():
    root, journal_name, final_name, installing_name = sys.argv[1:]
    root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    installing_fd = None
    journal_fd = None
    try:
        root_stat = os.fstat(root_fd)
        if (
            not stat.S_ISDIR(root_stat.st_mode)
            or root_stat.st_uid != 0
            or root_stat.st_gid != 0
            or stat.S_IMODE(root_stat.st_mode) != 0o700
        ):
            raise RuntimeError
        names = os.listdir(root_fd)
        if names != [journal_name] and sorted(names) != [journal_name]:
            raise RuntimeError
        journal_fd = os.open(
            journal_name,
            os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
            dir_fd=root_fd,
        )
        journal_stat = os.fstat(journal_fd)
        journal_content = os.pread(journal_fd, 4097, 0)
        journal_lines = journal_content.splitlines()
        if (
            not stat.S_ISREG(journal_stat.st_mode)
            or journal_stat.st_uid != 0
            or journal_stat.st_gid != 0
            or stat.S_IMODE(journal_stat.st_mode) != 0o600
            or journal_stat.st_nlink != 1
            or not 1 <= journal_stat.st_size <= 4096
            or len(journal_content) != journal_stat.st_size
            or len(journal_lines) < 2
            or journal_lines[0] != b'version=1'
            or journal_lines[1]
            not in {b'state=import_prepared', b'state=prepared', b'state=candidate_bound'}
        ):
            raise RuntimeError
        named_journal = os.stat(journal_name, dir_fd=root_fd, follow_symlinks=False)
        if (
            (named_journal.st_dev, named_journal.st_ino)
            != (journal_stat.st_dev, journal_stat.st_ino)
            or named_journal.st_mode != journal_stat.st_mode
            or named_journal.st_uid != journal_stat.st_uid
            or named_journal.st_gid != journal_stat.st_gid
            or named_journal.st_nlink != journal_stat.st_nlink
            or named_journal.st_size != journal_stat.st_size
        ):
            raise RuntimeError
        for name in (final_name, installing_name):
            try:
                os.stat(name, dir_fd=root_fd, follow_symlinks=False)
            except FileNotFoundError:
                continue
            raise RuntimeError
        installing_fd = os.open(
            installing_name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o400,
            dir_fd=root_fd,
        )
        os.fchown(installing_fd, 0, 0)
        os.fchmod(installing_fd, 0o400)
        offset = 0
        while offset < len(CONTENT):
            written = os.write(installing_fd, CONTENT[offset:])
            if written <= 0:
                raise RuntimeError
            offset += written
        os.fsync(installing_fd)
        installing_stat = os.fstat(installing_fd)
        if (
            not stat.S_ISREG(installing_stat.st_mode)
            or installing_stat.st_uid != 0
            or installing_stat.st_gid != 0
            or stat.S_IMODE(installing_stat.st_mode) != 0o400
            or installing_stat.st_nlink != 1
            or installing_stat.st_size != len(CONTENT)
        ):
            raise RuntimeError
        os.close(installing_fd)
        installing_fd = None
        os.rename(
            installing_name,
            final_name,
            src_dir_fd=root_fd,
            dst_dir_fd=root_fd,
        )
        os.fsync(root_fd)
        final_fd = os.open(final_name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=root_fd)
        try:
            final_stat = os.fstat(final_fd)
            if (
                not stat.S_ISREG(final_stat.st_mode)
                or final_stat.st_uid != 0
                or final_stat.st_gid != 0
                or stat.S_IMODE(final_stat.st_mode) != 0o400
                or final_stat.st_nlink != 1
                or final_stat.st_size != len(CONTENT)
                or os.read(final_fd, len(CONTENT) + 1) != CONTENT
            ):
                raise RuntimeError
        finally:
            os.close(final_fd)
        named_journal = os.stat(journal_name, dir_fd=root_fd, follow_symlinks=False)
        if (
            (named_journal.st_dev, named_journal.st_ino)
            != (journal_stat.st_dev, journal_stat.st_ino)
            or named_journal.st_mode != journal_stat.st_mode
            or named_journal.st_uid != journal_stat.st_uid
            or named_journal.st_gid != journal_stat.st_gid
            or named_journal.st_nlink != journal_stat.st_nlink
            or named_journal.st_size != journal_stat.st_size
            or os.pread(journal_fd, 4097, 0) != journal_content
        ):
            raise RuntimeError
    finally:
        if journal_fd is not None:
            os.close(journal_fd)
        if installing_fd is not None:
            os.close(installing_fd)
        os.close(root_fd)


try:
    main()
except BaseException:
    raise SystemExit(1)
PY
  )
  publisher_status=$?
  set -e
  [[ "$publisher_status" -eq 0 ]] || return 1
  set +e
  inspect_kemerbet_recovery_fallback
  fallback_status=$?
  set -e
  [[ "$fallback_status" -eq 0 &&
    -f "$KEMERBET_RECHECK_PROMOTION_ROOT/$KEMERBET_RECOVERY_FALLBACK_NAME" &&
    ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT/$KEMERBET_RECOVERY_FALLBACK_NAME" &&
    ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT/$KEMERBET_RECOVERY_FALLBACK_INSTALLING_NAME" &&
    ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT/$KEMERBET_RECOVERY_FALLBACK_INSTALLING_NAME" ]]
}

publish_kemerbet_recovery_latch() {
  local latch_status=0 publisher_status=0
  set +e
  inspect_kemerbet_recovery_latch
  latch_status=$?
  set -e
  [[ "$latch_status" -eq 1 ]] || return 1
  set +e
  (
    set -e
    env -i PATH="$SAFE_PATH" python3 -I - \
      "$KEMERBET_OWNER_RECEIPT_ROOT" "$KEMERBET_RECOVERY_LATCH_NAME" \
      "$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME" <<'PY'
import os
import stat
import sys

CONTENT = b"fetanagent-kemerbet-readiness-recovery-in-progress-or-failed-v1\n"


def main():
    root, final_name, installing_name = sys.argv[1:]
    root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    installing_fd = None
    try:
        root_stat = os.fstat(root_fd)
        if (
            not stat.S_ISDIR(root_stat.st_mode)
            or root_stat.st_uid != 0
            or root_stat.st_gid != 0
            or stat.S_IMODE(root_stat.st_mode) != 0o755
        ):
            raise RuntimeError
        for name in (final_name, installing_name):
            try:
                os.stat(name, dir_fd=root_fd, follow_symlinks=False)
            except FileNotFoundError:
                continue
            raise RuntimeError
        installing_fd = os.open(
            installing_name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o400,
            dir_fd=root_fd,
        )
        os.fchown(installing_fd, 0, 0)
        os.fchmod(installing_fd, 0o400)
        offset = 0
        while offset < len(CONTENT):
            written = os.write(installing_fd, CONTENT[offset:])
            if written <= 0:
                raise RuntimeError
            offset += written
        os.fsync(installing_fd)
        installing_stat = os.fstat(installing_fd)
        if (
            not stat.S_ISREG(installing_stat.st_mode)
            or installing_stat.st_uid != 0
            or installing_stat.st_gid != 0
            or stat.S_IMODE(installing_stat.st_mode) != 0o400
            or installing_stat.st_nlink != 1
            or installing_stat.st_size != len(CONTENT)
        ):
            raise RuntimeError
        os.close(installing_fd)
        installing_fd = None
        os.rename(
            installing_name,
            final_name,
            src_dir_fd=root_fd,
            dst_dir_fd=root_fd,
        )
        os.fsync(root_fd)
        final_fd = os.open(final_name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=root_fd)
        try:
            final_stat = os.fstat(final_fd)
            if (
                not stat.S_ISREG(final_stat.st_mode)
                or final_stat.st_uid != 0
                or final_stat.st_gid != 0
                or stat.S_IMODE(final_stat.st_mode) != 0o400
                or final_stat.st_nlink != 1
                or final_stat.st_size != len(CONTENT)
                or os.read(final_fd, len(CONTENT) + 1) != CONTENT
            ):
                raise RuntimeError
        finally:
            os.close(final_fd)
    finally:
        if installing_fd is not None:
            os.close(installing_fd)
        os.close(root_fd)


try:
    main()
except BaseException:
    raise SystemExit(1)
PY
  )
  publisher_status=$?
  set -e
  [[ "$publisher_status" -eq 0 ]] || return 1
  set +e
  inspect_kemerbet_recovery_latch
  latch_status=$?
  set -e
  [[ "$latch_status" -eq 0 &&
    ! -e "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME" &&
    ! -L "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME" ]] || return 1
  KEMERBET_RECOVERY_LATCH_DEV_INO="$(stat --format='%d:%i' \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_NAME")"
  [[ "$KEMERBET_RECOVERY_LATCH_DEV_INO" =~ ^[0-9]+:[0-9]+$ ]] || return 1
}

require_kemerbet_recovery_latch_authority() {
  local fallback_status=0 latch_status=0
  set +e
  inspect_kemerbet_recovery_fallback
  fallback_status=$?
  set -e
  [[ "$fallback_status" -eq 1 ]] ||
    die 'a durable KemerBet recovery fallback blocks readiness mutation'
  set +e
  inspect_kemerbet_recovery_latch
  latch_status=$?
  set -e
  if [[ "$latch_status" -eq 1 ]]; then
    [[ -z "$KEMERBET_RECOVERY_LATCH_DEV_INO" ]] ||
      die 'the KemerBet recovery latch authorization is inconsistent'
    return 0
  fi
  [[ "$latch_status" -eq 0 && "$KEMERBET_RECOVERY_LATCH_DEV_INO" =~ ^[0-9]+:[0-9]+$ &&
    ! -e "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME" &&
    ! -L "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME" &&
    "$(stat --format='%d:%i' "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_NAME" 2>/dev/null)" == \
      "$KEMERBET_RECOVERY_LATCH_DEV_INO" ]] ||
    die 'a pre-existing or unsafe KemerBet recovery latch blocks readiness mutation'
}

require_owned_kemerbet_recovery_latch() {
  [[ "$KEMERBET_RECOVERY_LATCH_DEV_INO" =~ ^[0-9]+:[0-9]+$ ]] ||
    die 'the current process does not own the KemerBet recovery latch'
  require_kemerbet_recovery_latch_authority || return 1
}

require_retryable_kemerbet_recovery_boundary() {
  local expected_claim_id="$KEMERBET_RECHECK_OWNER_CLAIM_ID"
  local expected_claim_dev_ino="$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO"
  local expected_identity_digest="$KEMERBET_RECHECK_IDENTITY_KEY_DIGEST"
  local expected_player_dev_ino="$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO"
  local expected_player_digest="$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"
  local expected_source_dev_ino="$KEMERBET_RECHECK_SOURCE_DEV_INO"
  local expected_source_digest="$KEMERBET_RECHECK_SOURCE_DIGEST"
  local receipt_path
  [[ "$expected_claim_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ &&
    "$expected_claim_dev_ino" =~ ^[0-9]+:[0-9]+$ &&
    "$expected_player_dev_ino" =~ ^[0-9]+:[0-9]+$ &&
    "$expected_player_digest" =~ ^[0-9a-f]{64}$ &&
    "$expected_source_dev_ino" =~ ^[0-9]+:[0-9]+$ &&
    "$expected_source_digest" =~ ^[0-9a-f]{64}$ &&
    "$expected_identity_digest" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the retryable KemerBet recovery identity is incomplete'
  [[ ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    ! -e "$KEMERBET_RECHECK_RECEIPT_ROOT" && ! -L "$KEMERBET_RECHECK_RECEIPT_ROOT" &&
    ! -e "$KEMERBET_RECHECK_CANDIDATE_ROOT" && ! -L "$KEMERBET_RECHECK_CANDIDATE_ROOT" &&
    ! -e "$KEMERBET_AGENT_IDENTITY_BINDINGS" && ! -L "$KEMERBET_AGENT_IDENTITY_BINDINGS" &&
    ! -e "$KEMERBET_READINESS_PLAYER_IDS" && ! -L "$KEMERBET_READINESS_PLAYER_IDS" ]] ||
    die 'the retryable KemerBet recovery retained an incompatible committed artifact'
  for receipt_path in \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_IMPORTED_CLAIM_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_IMPORTED_CLAIM_INSTALLING_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_COMPLETED_CLAIM_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_COMPLETED_CLAIM_INSTALLING_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_FAILED_CLAIM_INSTALLING_NAME"; do
    [[ ! -e "$receipt_path" && ! -L "$receipt_path" ]] ||
      die 'the retryable KemerBet recovery retained a conflicting receipt or installer'
  done
  require_retryable_kemerbet_binding_source "$expected_source_dev_ino" "$expected_source_digest" ||
    die 'the retryable KemerBet recovery binding source is not exact'
  require_root_readable_immutable_file "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" || return 1
  [[ "$(stat --format='%h' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")" == '1' &&
    "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" == \
      "$expected_identity_digest" ]] ||
    die 'the retryable KemerBet recovery identity key is not exact'
  inspect_owner_staged_kemerbet_cohort || return 1
  [[ "$KEMERBET_RECHECK_OWNER_CLAIM_ID" == "$expected_claim_id" &&
    "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" == "$expected_claim_dev_ino" &&
    "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" == "$expected_player_dev_ino" &&
    "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" == "$expected_player_digest" ]] ||
    die 'the restored retryable Owner KemerBet cohort does not match its journal'
  owner_kemerbet_cohort_marker require-failed "$expected_claim_id" ||
    die 'the restored retryable Owner KemerBet failure marker is not exact'
  for receipt_path in \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_IMPORTED_CLAIM_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_IMPORTED_CLAIM_INSTALLING_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_COMPLETED_CLAIM_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_COMPLETED_CLAIM_INSTALLING_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_FAILED_CLAIM_INSTALLING_NAME"; do
    [[ ! -e "$receipt_path" && ! -L "$receipt_path" ]] ||
      die 'the retryable KemerBet recovery receipt topology changed during inspection'
  done
  require_legacy_owner_kemerbet_receipt_paths_absent || return 1
  require_retryable_kemerbet_binding_source "$expected_source_dev_ino" "$expected_source_digest" ||
    die 'the retryable KemerBet recovery binding source changed during inspection'
  require_root_readable_immutable_file "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" || return 1
  [[ "$(stat --format='%h' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")" == '1' &&
    "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" == \
      "$expected_identity_digest" ]] ||
    die 'the retryable KemerBet recovery identity key changed during inspection'
}

require_prejournal_kemerbet_recovery_boundary() {
  local entries failed_path path source_size
  require_owned_kemerbet_recovery_latch || return 1
  [[ ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    ! -e "$KEMERBET_RECHECK_RECEIPT_ROOT" && ! -L "$KEMERBET_RECHECK_RECEIPT_ROOT" &&
    ! -e "$KEMERBET_RECHECK_CANDIDATE_ROOT" && ! -L "$KEMERBET_RECHECK_CANDIDATE_ROOT" &&
    ! -e "$KEMERBET_AGENT_IDENTITY_BINDINGS" && ! -L "$KEMERBET_AGENT_IDENTITY_BINDINGS" &&
    ! -e "$KEMERBET_READINESS_PLAYER_IDS" && ! -L "$KEMERBET_READINESS_PLAYER_IDS" ]] ||
    die 'the pre-journal KemerBet recovery retained a derived artifact'
  require_kemerbet_readiness_output_directory || return 1
  [[ ! -L "$KEMERBET_READINESS_BINDING" && -f "$KEMERBET_READINESS_BINDING" &&
    "$(realpath -- "$KEMERBET_READINESS_BINDING")" == "$KEMERBET_READINESS_BINDING" &&
    "$(stat --format='%u:%g:%a:%h' "$KEMERBET_READINESS_BINDING")" == '10001:10001:600:1' ]] ||
    die 'the pre-journal KemerBet binding source is unsafe'
  source_size="$(stat --format='%s' "$KEMERBET_READINESS_BINDING")"
  [[ "$source_size" == '230' &&
    "$(wc -l <"$KEMERBET_READINESS_BINDING")" == '1' ]] ||
    die 'the pre-journal KemerBet binding source shape is invalid'
  require_kemerbet_v3_binding_content "$KEMERBET_READINESS_BINDING" ||
    die 'the pre-journal KemerBet v3 binding source contract is invalid'
  require_kemerbet_identity_key_file "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" || return 1
  [[ "$(stat --format='%h' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")" == '1' ]] ||
    die 'the pre-journal KemerBet identity key has an unsafe link count'
  require_root_readable_immutable_file "$KEMERBET_SELECTOR_CONTRACT" || return 1
  [[ "$(stat --format='%h' "$KEMERBET_SELECTOR_CONTRACT")" == '1' ]] ||
    die 'the pre-journal KemerBet selector has an unsafe link count'
  for path in \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_IMPORTED_CLAIM_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_IMPORTED_CLAIM_INSTALLING_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_COMPLETED_CLAIM_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_COMPLETED_CLAIM_INSTALLING_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_FAILED_CLAIM_INSTALLING_NAME"; do
    [[ ! -e "$path" && ! -L "$path" ]] ||
      die 'the pre-journal KemerBet recovery retained a conflicting receipt or installer'
  done
  inspect_owner_staged_kemerbet_cohort || return 1
  failed_path="$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_FAILED_CLAIM_NAME"
  if [[ -e "$failed_path" || -L "$failed_path" ]]; then
    owner_kemerbet_cohort_marker require-failed "$KEMERBET_RECHECK_OWNER_CLAIM_ID" ||
      die 'the pre-journal retryable KemerBet failure marker is not exact'
  fi
  entries="$(find -P "$KEMERBET_OWNER_RECEIPT_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" ||
    die 'the pre-journal KemerBet receipt boundary could not be inspected'
  [[ "$entries" == "$KEMERBET_RECOVERY_LATCH_NAME" ||
    "$entries" == "$KEMERBET_OWNER_FAILED_CLAIM_NAME"$'\n'"$KEMERBET_RECOVERY_LATCH_NAME" ]] ||
    die 'the pre-journal KemerBet receipt boundary is not exact'
  require_legacy_owner_kemerbet_receipt_paths_absent || return 1
  require_kemerbet_readiness_output_directory || return 1
}

require_retired_kemerbet_recovery_boundary() {
  [[ ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" ]] ||
    die 'the KemerBet recovery did not retire its promotion root'
  case "$KEMERBET_RECHECK_RECOVERY_OUTCOME" in
    committed)
      require_committed_kemerbet_recheck_boundary_shape || return 1
      require_completed_owner_kemerbet_cohort_marker || return 1
      ;;
    retryable) require_retryable_kemerbet_recovery_boundary || return 1 ;;
    prejournal_no_mutation) require_prejournal_kemerbet_recovery_boundary || return 1 ;;
    *) die 'the retired KemerBet recovery outcome is missing or invalid' ;;
  esac
  require_owned_kemerbet_recovery_latch || return 1
}

retire_owned_kemerbet_recovery_latch() {
  local expected_dev_ino="$KEMERBET_RECOVERY_LATCH_DEV_INO" retire_status=0
  [[ "$expected_dev_ino" =~ ^[0-9]+:[0-9]+$ ]] || return 1
  require_retired_kemerbet_recovery_boundary || return 1
  # The independently verified recovery boundary is necessary but not sufficient to remove the
  # write-ahead latch. Re-prove the exact live Owner/read-only bind immediately before unlink so a
  # stopped Owner or a newly overlapping holder leaves the durable latch for manual remediation.
  require_owner_kemerbet_receipt_service_access || return 1
  set +e
  (
    set -e
    env -i PATH="$SAFE_PATH" python3 -I - \
      "$KEMERBET_OWNER_RECEIPT_ROOT" "$KEMERBET_RECOVERY_LATCH_NAME" \
      "$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME" "$expected_dev_ino" <<'PY'
import os
import stat
import sys

CONTENT = b"fetanagent-kemerbet-readiness-recovery-in-progress-or-failed-v1\n"


def write_replacement(root_fd, final_name):
    replacement_fd = os.open(
        final_name,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
        0o400,
        dir_fd=root_fd,
    )
    try:
        os.fchown(replacement_fd, 0, 0)
        os.fchmod(replacement_fd, 0o400)
        offset = 0
        while offset < len(CONTENT):
            written = os.write(replacement_fd, CONTENT[offset:])
            if written <= 0:
                raise RuntimeError
            offset += written
        os.fsync(replacement_fd)
    finally:
        os.close(replacement_fd)
    os.fsync(root_fd)


def main():
    root, final_name, installing_name, expected_dev_ino = sys.argv[1:]
    root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    final_fd = None
    unlinked = False
    try:
        root_stat = os.fstat(root_fd)
        if (
            not stat.S_ISDIR(root_stat.st_mode)
            or root_stat.st_uid != 0
            or root_stat.st_gid != 0
            or stat.S_IMODE(root_stat.st_mode) != 0o755
        ):
            raise RuntimeError
        try:
            os.stat(installing_name, dir_fd=root_fd, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise RuntimeError
        final_fd = os.open(final_name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=root_fd)
        final_stat = os.fstat(final_fd)
        if (
            not stat.S_ISREG(final_stat.st_mode)
            or final_stat.st_uid != 0
            or final_stat.st_gid != 0
            or stat.S_IMODE(final_stat.st_mode) != 0o400
            or final_stat.st_nlink != 1
            or final_stat.st_size != len(CONTENT)
            or f"{final_stat.st_dev}:{final_stat.st_ino}" != expected_dev_ino
            or os.read(final_fd, len(CONTENT) + 1) != CONTENT
        ):
            raise RuntimeError
        os.unlink(final_name, dir_fd=root_fd)
        unlinked = True
        try:
            os.fsync(root_fd)
        except BaseException:
            write_replacement(root_fd, final_name)
            raise
        try:
            os.stat(final_name, dir_fd=root_fd, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise RuntimeError
    except BaseException:
        if unlinked:
            try:
                os.stat(final_name, dir_fd=root_fd, follow_symlinks=False)
            except FileNotFoundError:
                try:
                    write_replacement(root_fd, final_name)
                except BaseException:
                    pass
        raise
    finally:
        if final_fd is not None:
            os.close(final_fd)
        os.close(root_fd)


try:
    main()
except BaseException:
    raise SystemExit(1)
PY
  )
  retire_status=$?
  set -e
  [[ "$retire_status" -eq 0 ]] || return 1
  [[ ! -e "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_NAME" &&
    ! -L "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_NAME" &&
    ! -e "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME" &&
    ! -L "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME" ]] || return 1
  KEMERBET_RECOVERY_LATCH_DEV_INO=''
}

recover_incomplete_kemerbet_recheck_promotion_guarded() {
  local fallback_status=0 latch_status=0
  set +e
  inspect_kemerbet_recovery_fallback
  fallback_status=$?
  set -e
  [[ "$fallback_status" -eq 1 ]] ||
    die 'a durable KemerBet recovery fallback requires manual root remediation'
  set +e
  inspect_kemerbet_recovery_latch
  latch_status=$?
  set -e
  [[ "$latch_status" -eq 1 ]] ||
    die 'a pre-existing or unsafe KemerBet recovery latch requires manual root remediation'
  if [[ ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" ]]; then
    return 0
  fi
  # This read-only liveness/mount proof must precede latch publication itself. The raw recovery
  # repeats it after publication and before its first journal, candidate, stage, or marker mutation.
  require_owner_kemerbet_receipt_service_access
  publish_kemerbet_recovery_latch ||
    die 'the KemerBet recovery latch could not be published before recovery'
  require_owned_kemerbet_recovery_latch
  recover_incomplete_kemerbet_recheck_promotion
  require_retired_kemerbet_recovery_boundary
  retire_owned_kemerbet_recovery_latch ||
    die 'the successful KemerBet recovery latch could not be retired durably'
}

recover_incomplete_kemerbet_recheck_promotion() {
  local actual_entries candidate_dev_ino candidate_digest claim_id entry player_ids_dev_ino
  local commit_sha receipt_entries receipt_present canonical_present session_container source_dev_ino state
  local owner_player_ids_dev_ino owner_claim_dev_ino player_ids_digest
  local -a journal_lines=()
  if [[ ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" ]]; then
    return 0
  fi
  KEMERBET_RECHECK_RECOVERY_OUTCOME=''
  require_owned_kemerbet_recovery_latch
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" && -d "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(realpath -- "$KEMERBET_RECHECK_PROMOTION_ROOT")" == "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(stat --format='%U:%G:%a' "$KEMERBET_RECHECK_PROMOTION_ROOT")" == 'root:root:700' ]] ||
    die 'an interrupted KemerBet promotion root is unsafe'
  # This liveness/read-only preflight precedes every journal, candidate, stage, or receipt mutation.
  # A rerun after emergency teardown therefore preserves all root recovery evidence unchanged.
  require_owner_kemerbet_receipt_service_access
  actual_entries="$(find -P "$KEMERBET_RECHECK_PROMOTION_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" ||
    die 'the interrupted KemerBet promotion root could not be inspected'
  receipt_present='false'
  canonical_present='false'
  if [[ -e "$KEMERBET_RECHECK_RECEIPT_ROOT" || -L "$KEMERBET_RECHECK_RECEIPT_ROOT" ]]; then
    [[ ! -L "$KEMERBET_RECHECK_RECEIPT_ROOT" && -d "$KEMERBET_RECHECK_RECEIPT_ROOT" &&
      "$(realpath -- "$KEMERBET_RECHECK_RECEIPT_ROOT")" == "$KEMERBET_RECHECK_RECEIPT_ROOT" &&
      "$(stat --format='%U:%G:%a' "$KEMERBET_RECHECK_RECEIPT_ROOT")" == 'root:root:700' ]] ||
      die 'an interrupted KemerBet receipt root is unsafe'
    receipt_entries="$(find -P "$KEMERBET_RECHECK_RECEIPT_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" ||
      die 'the interrupted KemerBet receipt root could not be inspected'
    if [[ -z "$receipt_entries" ]]; then
      # The receipt directory is durably created before its fixed receipt. A host crash in that
      # interval leaves an empty, root-owned directory that is an uncommitted partial receipt.
      receipt_present='partial'
    elif [[ "$receipt_entries" == 'ready-v1' ]]; then
      receipt_present='true'
    elif [[ "$receipt_entries" =~ ^\.ready-v1\.[A-Za-z0-9]+$'\n'ready-v1$ ]]; then
      entry="$KEMERBET_RECHECK_RECEIPT_ROOT/${receipt_entries%%$'\n'*}"
      [[ ! -L "$entry" && -f "$entry" && ! -L "$KEMERBET_RECHECK_RECEIPT" &&
        -f "$KEMERBET_RECHECK_RECEIPT" &&
        "$(stat --format='%U:%G:%a:%h:%d:%i' "$entry")" == \
        "$(stat --format='%U:%G:%a:%h:%d:%i' "$KEMERBET_RECHECK_RECEIPT")" &&
        "$(stat --format='%U:%G:%a:%h' "$entry")" == 'root:root:600:2' ]] ||
        die 'the interrupted linked KemerBet receipt is unsafe'
      rm -f -- "$entry"
      sync -f "$KEMERBET_RECHECK_RECEIPT_ROOT" ||
        die 'the interrupted linked KemerBet receipt could not be synchronized'
      receipt_present='true'
    elif [[ "$receipt_entries" =~ ^\.ready-v1\.[A-Za-z0-9]+$ ]]; then
      receipt_present='partial'
    else
      die 'the interrupted KemerBet receipt root contains unexpected residue'
    fi
  fi
  [[ ! -e "$KEMERBET_AGENT_IDENTITY_BINDINGS" && ! -L "$KEMERBET_AGENT_IDENTITY_BINDINGS" ]] ||
    canonical_present='true'

  if [[ ! -e "$KEMERBET_RECHECK_PROMOTION_JOURNAL" && ! -L "$KEMERBET_RECHECK_PROMOTION_JOURNAL" ]]; then
    if [[ -z "$actual_entries" ]]; then
      if [[ "$receipt_present" != "$canonical_present" ]]; then
        die 'an interrupted KemerBet promotion has an ambiguous committed boundary'
      fi
      if [[ "$receipt_present" == 'true' ]]; then
        require_committed_kemerbet_recheck_boundary_shape
        require_completed_owner_kemerbet_cohort_marker
        KEMERBET_RECHECK_RECOVERY_OUTCOME='committed'
      else
        KEMERBET_RECHECK_RECOVERY_OUTCOME='prejournal_no_mutation'
      fi
      remove_owned_kemerbet_recheck_promotion_root ||
        die 'the interrupted KemerBet promotion root could not be removed'
      return 0
    fi
    [[ "$actual_entries" =~ ^\.pending-v1\.[A-Za-z0-9]+$ &&
      "$receipt_present" == 'false' && "$canonical_present" == 'false' ]] ||
      die 'an interrupted KemerBet promotion journal is incomplete or ambiguous'
    entry="$KEMERBET_RECHECK_PROMOTION_ROOT/$actual_entries"
    [[ ! -L "$entry" && -f "$entry" &&
      "$(stat --format='%U:%G:%a' "$entry")" == 'root:root:600' ]] ||
      die 'the interrupted KemerBet promotion-journal temporary is unsafe'
    remove_owned_kemerbet_recheck_promotion_root ||
      die 'the interrupted KemerBet promotion root could not be removed'
    KEMERBET_RECHECK_RECOVERY_OUTCOME='prejournal_no_mutation'
    return 0
  fi

  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_JOURNAL" && -f "$KEMERBET_RECHECK_PROMOTION_JOURNAL" ]] ||
    die 'the interrupted KemerBet promotion journal is unsafe'
  if [[ "$actual_entries" != 'pending-v1' ]]; then
    [[ "$actual_entries" =~ ^\.pending-v1\.[A-Za-z0-9]+$'\n'pending-v1$ ]] ||
      die 'the interrupted KemerBet promotion journal contains unexpected residue'
    entry="$KEMERBET_RECHECK_PROMOTION_ROOT/${actual_entries%%$'\n'*}"
    [[ ! -L "$entry" && -f "$entry" &&
      "$(stat --format='%U:%G:%a' "$entry")" == 'root:root:600' ]] ||
      die 'the interrupted KemerBet promotion-journal temporary is unsafe'
    rm -f -- "$entry"
    sync -f "$KEMERBET_RECHECK_PROMOTION_ROOT" ||
      die 'the interrupted KemerBet promotion journal could not be synchronized'
  fi
  [[ "$(stat --format='%U:%G:%a:%h' "$KEMERBET_RECHECK_PROMOTION_JOURNAL")" == 'root:root:600:1' ]] ||
    die 'the interrupted KemerBet promotion journal ownership, mode, or link count is unsafe'
  mapfile -t journal_lines <"$KEMERBET_RECHECK_PROMOTION_JOURNAL"
  [[ "${#journal_lines[@]}" -ge 2 && "${journal_lines[0]}" == 'version=1' ]] ||
    die 'the interrupted KemerBet promotion journal header is invalid'
  state="${journal_lines[1]}"

  if [[ "$state" == 'state=import_prepared' ]]; then
    [[ "${#journal_lines[@]}" -eq 14 &&
      "${journal_lines[2]}" =~ ^release=[0-9a-f]{40}$ &&
      "${journal_lines[3]}" =~ ^source_dev_ino=[0-9]+:[0-9]+$ &&
      "${journal_lines[4]}" =~ ^binding_sha256=[0-9a-f]{64}$ &&
      "${journal_lines[5]}" =~ ^identity_hmac_key_sha256=[0-9a-f]{64}$ &&
      "${journal_lines[6]}" =~ ^selector_sha256=[0-9a-f]{64}$ &&
      "${journal_lines[7]}" =~ ^image_id=sha256:[0-9a-f]{64}$ &&
      "${journal_lines[8]}" == "profile_volume=$KEMERBET_PROFILE_VOLUME" &&
      "${journal_lines[9]}" =~ ^session_container=(none|[0-9a-f]{12,64})$ &&
      "${journal_lines[10]}" =~ ^owner_stage_player_ids_dev_ino=[0-9]+:[0-9]+$ &&
      "${journal_lines[11]}" =~ ^owner_stage_claim_dev_ino=[0-9]+:[0-9]+$ &&
      "${journal_lines[12]}" =~ ^claim_id=[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ &&
      "${journal_lines[13]}" =~ ^player_ids_sha256=[0-9a-f]{64}$ &&
      "$receipt_present" == 'false' && "$canonical_present" == 'false' ]] ||
      die 'the interrupted import-prepared KemerBet promotion journal is invalid or ambiguous'
    commit_sha="${journal_lines[2]#release=}"
    source_dev_ino="${journal_lines[3]#source_dev_ino=}"
    candidate_digest="${journal_lines[4]#binding_sha256=}"
    session_container="${journal_lines[9]#session_container=}"
    owner_player_ids_dev_ino="${journal_lines[10]#owner_stage_player_ids_dev_ino=}"
    owner_claim_dev_ino="${journal_lines[11]#owner_stage_claim_dev_ino=}"
    claim_id="${journal_lines[12]#claim_id=}"
    player_ids_digest="${journal_lines[13]#player_ids_sha256=}"
    KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO="$owner_player_ids_dev_ino"
    KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO="$owner_claim_dev_ino"
    KEMERBET_RECHECK_OWNER_CLAIM_ID="$claim_id"
    KEMERBET_RECHECK_PLAYER_IDS_DIGEST="$player_ids_digest"
    KEMERBET_RECHECK_SOURCE_DEV_INO="$source_dev_ino"
    KEMERBET_RECHECK_SOURCE_DIGEST="$candidate_digest"
    KEMERBET_RECHECK_IDENTITY_KEY_DIGEST="${journal_lines[5]#identity_hmac_key_sha256=}"
    remove_kemerbet_recheck_container || die 'an interrupted KemerBet recheck container could not be removed'
    remove_kemerbet_recheck_network || die 'an interrupted KemerBet recheck network could not be removed'
    remove_kemerbet_recheck_rpc_capabilities ||
      die 'interrupted KemerBet recheck RPC capabilities could not be removed'
    remove_journaled_kemerbet_session_provision "$session_container" "$commit_sha"
    require_kemerbet_profile_volume_holders ''
    require_retryable_kemerbet_binding_source "$source_dev_ino" "$candidate_digest" ||
      die 'the interrupted import-prepared KemerBet binding source changed'
    [[ ! -L "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" && -f "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" &&
      "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" == \
      "${journal_lines[5]#identity_hmac_key_sha256=}" ]] ||
      die 'the interrupted import-prepared KemerBet identity key changed'
    require_root_readable_immutable_file "$KEMERBET_SELECTOR_CONTRACT"
    [[ "$(sha256sum -- "$KEMERBET_SELECTOR_CONTRACT" | awk '{print $1}')" == \
      "${journal_lines[6]#selector_sha256=}" ]] ||
      die 'the interrupted import-prepared KemerBet selector changed'
    owner_kemerbet_cohort_marker remove-failed "$claim_id" ||
      die 'the retryable KemerBet cohort marker could not be retired'
    promote_owner_staged_kemerbet_player_ids
    require_service_file "$KEMERBET_READINESS_PLAYER_IDS"
    player_ids_dev_ino="$(stat --format='%d:%i' "$KEMERBET_READINESS_PLAYER_IDS")"
    KEMERBET_RECHECK_PLAYER_IDS_DEV_INO="$player_ids_dev_ino"
    advance_kemerbet_recheck_import_journal_to_prepared \
      "$commit_sha" "$source_dev_ino" "$candidate_digest" \
      "${journal_lines[5]#identity_hmac_key_sha256=}" \
      "${journal_lines[6]#selector_sha256=}" "${journal_lines[7]#image_id=}" \
      "$session_container" "$player_ids_dev_ino" \
      "$owner_player_ids_dev_ino" "$owner_claim_dev_ino" "$claim_id" "$player_ids_digest"
    owner_kemerbet_cohort_marker publish-imported "$claim_id" ||
      die 'the interrupted KemerBet cohort import marker could not be published'
    consume_exact_one_use_kemerbet_file \
      "$KEMERBET_READINESS_PLAYER_IDS" "$player_ids_dev_ino" "$player_ids_digest" ||
      die 'the interrupted imported KemerBet Player-ID file could not be removed'
    restore_retryable_owner_staged_kemerbet_cohort ||
      die 'the interrupted Owner KemerBet cohort could not be restored for retry'
    repair_kemerbet_identity_key_readability ||
      die 'the KemerBet identity key could not be repaired after interrupted import'
    remove_owned_kemerbet_recheck_promotion_root ||
      die 'the interrupted import-prepared KemerBet promotion journal could not be retired'
    KEMERBET_RECHECK_RECOVERY_OUTCOME='retryable'
    return 0
  fi

  if [[ "$state" == 'state=prepared' ]]; then
    [[ "${#journal_lines[@]}" -eq 15 &&
      "${journal_lines[2]}" =~ ^release=[0-9a-f]{40}$ &&
      "${journal_lines[3]}" =~ ^source_dev_ino=[0-9]+:[0-9]+$ &&
      "${journal_lines[4]}" =~ ^binding_sha256=[0-9a-f]{64}$ &&
      "${journal_lines[5]}" =~ ^identity_hmac_key_sha256=[0-9a-f]{64}$ &&
      "${journal_lines[6]}" =~ ^selector_sha256=[0-9a-f]{64}$ &&
      "${journal_lines[7]}" =~ ^image_id=sha256:[0-9a-f]{64}$ &&
      "${journal_lines[8]}" == "profile_volume=$KEMERBET_PROFILE_VOLUME" &&
      "${journal_lines[9]}" =~ ^session_container=(none|[0-9a-f]{12,64})$ &&
      "${journal_lines[10]}" =~ ^player_ids_dev_ino=[0-9]+:[0-9]+$ &&
      "${journal_lines[11]}" =~ ^owner_stage_player_ids_dev_ino=[0-9]+:[0-9]+$ &&
      "${journal_lines[12]}" =~ ^owner_stage_claim_dev_ino=[0-9]+:[0-9]+$ &&
      "${journal_lines[13]}" =~ ^claim_id=[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ &&
      "${journal_lines[14]}" =~ ^player_ids_sha256=[0-9a-f]{64}$ &&
      "$receipt_present" == 'false' && "$canonical_present" == 'false' ]] ||
      die 'the interrupted prepared KemerBet promotion journal is invalid or ambiguous'
    commit_sha="${journal_lines[2]#release=}"
    source_dev_ino="${journal_lines[3]#source_dev_ino=}"
    candidate_digest="${journal_lines[4]#binding_sha256=}"
    session_container="${journal_lines[9]#session_container=}"
    player_ids_dev_ino="${journal_lines[10]#player_ids_dev_ino=}"
    owner_player_ids_dev_ino="${journal_lines[11]#owner_stage_player_ids_dev_ino=}"
    owner_claim_dev_ino="${journal_lines[12]#owner_stage_claim_dev_ino=}"
    claim_id="${journal_lines[13]#claim_id=}"
    player_ids_digest="${journal_lines[14]#player_ids_sha256=}"
    KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO="$owner_player_ids_dev_ino"
    KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO="$owner_claim_dev_ino"
    KEMERBET_RECHECK_OWNER_CLAIM_ID="$claim_id"
    KEMERBET_RECHECK_PLAYER_IDS_DIGEST="$player_ids_digest"
    KEMERBET_RECHECK_SOURCE_DEV_INO="$source_dev_ino"
    KEMERBET_RECHECK_SOURCE_DIGEST="$candidate_digest"
    KEMERBET_RECHECK_IDENTITY_KEY_DIGEST="${journal_lines[5]#identity_hmac_key_sha256=}"
    remove_kemerbet_recheck_container || die 'an interrupted KemerBet recheck container could not be removed'
    remove_kemerbet_recheck_network || die 'an interrupted KemerBet recheck network could not be removed'
    remove_kemerbet_recheck_rpc_capabilities ||
      die 'interrupted KemerBet recheck RPC capabilities could not be removed'
    remove_journaled_kemerbet_session_provision "$session_container" "$commit_sha"
    require_kemerbet_profile_volume_holders ''
    require_retryable_kemerbet_binding_source "$source_dev_ino" "$candidate_digest" ||
      die 'the interrupted prepared KemerBet binding source changed'
    [[ ! -L "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" && -f "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" &&
      "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" == \
      "${journal_lines[5]#identity_hmac_key_sha256=}" ]] ||
      die 'the interrupted prepared KemerBet identity key changed'
    require_root_readable_immutable_file "$KEMERBET_SELECTOR_CONTRACT"
    [[ "$(sha256sum -- "$KEMERBET_SELECTOR_CONTRACT" | awk '{print $1}')" == \
      "${journal_lines[6]#selector_sha256=}" ]] ||
      die 'the interrupted prepared KemerBet selector changed'
    # In prepared state the fixed candidate path did not exist before this journal. A crash may
    # interrupt `install` mid-copy, so ownership/path checks—not a completed digest—authorize its
    # rollback. A digest becomes mandatory only after the candidate_bound state is durable.
    remove_kemerbet_recheck_candidate || die 'the interrupted prepared KemerBet candidate could not be removed'
    consume_exact_one_use_kemerbet_file \
      "$KEMERBET_READINESS_PLAYER_IDS" "$player_ids_dev_ino" "$player_ids_digest" ||
      die 'the interrupted one-use KemerBet Player-ID source could not be removed'
    restore_retryable_owner_staged_kemerbet_cohort ||
      die 'the interrupted Owner KemerBet cohort could not be restored for retry'
    repair_kemerbet_identity_key_readability ||
      die 'the KemerBet identity key could not be repaired after interruption'
    [[ "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" == \
      "${journal_lines[5]#identity_hmac_key_sha256=}" ]] ||
      die 'the repaired KemerBet identity key no longer matches its journal'
    remove_owned_kemerbet_recheck_promotion_root ||
      die 'the interrupted prepared KemerBet promotion journal could not be retired'
    KEMERBET_RECHECK_RECOVERY_OUTCOME='retryable'
    return 0
  fi

  [[ "$state" == 'state=candidate_bound' && "${#journal_lines[@]}" -eq 17 &&
    "${journal_lines[2]}" =~ ^release=[0-9a-f]{40}$ &&
    "${journal_lines[3]}" =~ ^source_dev_ino=[0-9]+:[0-9]+$ &&
    "${journal_lines[4]}" =~ ^binding_dev_ino=[0-9]+:[0-9]+$ &&
    "${journal_lines[5]}" =~ ^binding_sha256=[0-9a-f]{64}$ &&
    "${journal_lines[6]}" =~ ^identity_hmac_key_sha256=[0-9a-f]{64}$ &&
    "${journal_lines[7]}" =~ ^selector_sha256=[0-9a-f]{64}$ &&
    "${journal_lines[8]}" =~ ^image_id=sha256:[0-9a-f]{64}$ &&
    "${journal_lines[9]}" == "profile_volume=$KEMERBET_PROFILE_VOLUME" &&
    "${journal_lines[10]}" =~ ^profile_identity_sha256=[0-9a-f]{64}$ &&
    "${journal_lines[11]}" =~ ^session_container=(none|[0-9a-f]{12,64})$ &&
    "${journal_lines[12]}" =~ ^player_ids_dev_ino=[0-9]+:[0-9]+$ &&
    "${journal_lines[13]}" =~ ^owner_stage_player_ids_dev_ino=[0-9]+:[0-9]+$ &&
    "${journal_lines[14]}" =~ ^owner_stage_claim_dev_ino=[0-9]+:[0-9]+$ &&
    "${journal_lines[15]}" =~ ^claim_id=[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ &&
    "${journal_lines[16]}" =~ ^player_ids_sha256=[0-9a-f]{64}$ ]] ||
    die 'the interrupted candidate-bound KemerBet promotion journal is invalid'
  commit_sha="${journal_lines[2]#release=}"
  source_dev_ino="${journal_lines[3]#source_dev_ino=}"
  candidate_dev_ino="${journal_lines[4]#binding_dev_ino=}"
  candidate_digest="${journal_lines[5]#binding_sha256=}"
  session_container="${journal_lines[11]#session_container=}"
  player_ids_dev_ino="${journal_lines[12]#player_ids_dev_ino=}"
  owner_player_ids_dev_ino="${journal_lines[13]#owner_stage_player_ids_dev_ino=}"
  owner_claim_dev_ino="${journal_lines[14]#owner_stage_claim_dev_ino=}"
  claim_id="${journal_lines[15]#claim_id=}"
  player_ids_digest="${journal_lines[16]#player_ids_sha256=}"
  KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO="$owner_player_ids_dev_ino"
  KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO="$owner_claim_dev_ino"
  KEMERBET_RECHECK_OWNER_CLAIM_ID="$claim_id"
  KEMERBET_RECHECK_PLAYER_IDS_DIGEST="$player_ids_digest"
  KEMERBET_RECHECK_SOURCE_DEV_INO="$source_dev_ino"
  KEMERBET_RECHECK_SOURCE_DIGEST="$candidate_digest"
  KEMERBET_RECHECK_IDENTITY_KEY_DIGEST="${journal_lines[6]#identity_hmac_key_sha256=}"

  remove_kemerbet_recheck_container || die 'an interrupted KemerBet recheck container could not be removed'
  remove_kemerbet_recheck_network || die 'an interrupted KemerBet recheck network could not be removed'
  remove_kemerbet_recheck_rpc_capabilities ||
    die 'interrupted KemerBet recheck RPC capabilities could not be removed'
  remove_journaled_kemerbet_session_provision "$session_container" "$commit_sha"
  require_kemerbet_profile_volume_holders ''

  [[ ! -L "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" && -f "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" &&
    "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" == \
    "${journal_lines[6]#identity_hmac_key_sha256=}" ]] ||
    die 'the interrupted candidate-bound KemerBet identity key changed'
  require_root_readable_immutable_file "$KEMERBET_SELECTOR_CONTRACT"
  [[ "$(sha256sum -- "$KEMERBET_SELECTOR_CONTRACT" | awk '{print $1}')" == \
    "${journal_lines[7]#selector_sha256=}" ]] ||
    die 'the interrupted candidate-bound KemerBet selector changed'

  if [[ "$receipt_present" == 'partial' ]]; then
    remove_owned_kemerbet_recheck_receipt_root ||
      die 'the interrupted partial KemerBet receipt could not be rolled back'
    receipt_present='false'
  fi
  if [[ "$receipt_present" == 'true' && "$canonical_present" != 'true' ]]; then
    die 'an interrupted KemerBet recheck receipt lacks its committed binding'
  fi
  if [[ "$receipt_present" == 'true' && "$canonical_present" == 'true' ]]; then
    require_kemerbet_recheck_receipt \
      "$commit_sha" "$candidate_digest" \
      "${journal_lines[6]#identity_hmac_key_sha256=}" \
      "${journal_lines[7]#selector_sha256=}" "${journal_lines[8]#image_id=}" \
      "${journal_lines[10]#profile_identity_sha256=}"
    require_kemerbet_recheck_promotion_journal \
      "$commit_sha" "$source_dev_ino" "$candidate_dev_ino" "$candidate_digest" \
      "${journal_lines[6]#identity_hmac_key_sha256=}" \
      "${journal_lines[7]#selector_sha256=}" "${journal_lines[8]#image_id=}" \
      "${journal_lines[10]#profile_identity_sha256=}" "$session_container" \
      "$player_ids_dev_ino" "$owner_player_ids_dev_ino" "$owner_claim_dev_ino" \
      "$claim_id" "$player_ids_digest"
    # The exact current release/image/profile/runtime/no-holder/singleton/no-transient boundary is
    # re-proved before recovery is allowed to consume anything or publish completed-v1.
    require_current_kemerbet_success_runtime_boundary \
      "$commit_sha" "$candidate_digest" "${journal_lines[6]#identity_hmac_key_sha256=}" \
      "${journal_lines[7]#selector_sha256=}" "${journal_lines[8]#image_id=}" \
      "${journal_lines[10]#profile_identity_sha256=}" require-receipt
    require_committed_kemerbet_cleanup_artifacts \
      "$source_dev_ino" "$candidate_dev_ino" "$candidate_digest" \
      "$player_ids_dev_ino" "$player_ids_digest"
    KEMERBET_RECHECK_CANDIDATE_DEV_INO="$candidate_dev_ino"
    KEMERBET_RECHECK_CANDIDATE_DIGEST="$candidate_digest"
    consume_exact_one_use_kemerbet_file \
      "$KEMERBET_READINESS_PLAYER_IDS" "$player_ids_dev_ino" "$player_ids_digest" ||
      die 'the interrupted committed KemerBet Player-ID file could not be consumed'
    remove_kemerbet_recheck_candidate ||
      die 'the interrupted committed KemerBet candidate could not be retired'
    consume_exact_kemerbet_binding_source "$source_dev_ino" "$candidate_digest" ||
      die 'the interrupted committed KemerBet binding source could not be consumed'
    repair_kemerbet_identity_key_readability ||
      die 'the KemerBet identity key could not be repaired after committed recovery'
    require_committed_kemerbet_recheck_boundary_shape
    require_current_kemerbet_success_runtime_boundary \
      "$commit_sha" "$candidate_digest" "${journal_lines[6]#identity_hmac_key_sha256=}" \
      "${journal_lines[7]#selector_sha256=}" "${journal_lines[8]#image_id=}" \
      "${journal_lines[10]#profile_identity_sha256=}" require-receipt
    [[ ! -e "$KEMERBET_READINESS_PLAYER_IDS" && ! -L "$KEMERBET_READINESS_PLAYER_IDS" &&
      ! -e "$KEMERBET_RECHECK_CANDIDATE_ROOT" && ! -L "$KEMERBET_RECHECK_CANDIDATE_ROOT" &&
      ! -e "$KEMERBET_READINESS_BINDING" && ! -L "$KEMERBET_READINESS_BINDING" ]] ||
      die 'the interrupted committed KemerBet cleanup retained an input'
    complete_owner_staged_kemerbet_cohort ||
      die 'the interrupted committed Owner KemerBet cohort could not be completed'
    require_completed_owner_kemerbet_cohort_marker
    require_committed_kemerbet_recheck_boundary_shape
    require_current_kemerbet_success_runtime_boundary \
      "$commit_sha" "$candidate_digest" "${journal_lines[6]#identity_hmac_key_sha256=}" \
      "${journal_lines[7]#selector_sha256=}" "${journal_lines[8]#image_id=}" \
      "${journal_lines[10]#profile_identity_sha256=}" require-receipt
    remove_owned_kemerbet_recheck_promotion_root ||
      die 'the interrupted committed KemerBet promotion journal could not be retired'
    KEMERBET_RECHECK_RECOVERY_OUTCOME='committed'
    KEMERBET_RECHECK_CANDIDATE_DEV_INO=''
    KEMERBET_RECHECK_CANDIDATE_DIGEST=''
    return 0
  fi
  KEMERBET_RECHECK_CANDIDATE_DEV_INO="$candidate_dev_ino"
  KEMERBET_RECHECK_CANDIDATE_DIGEST="$candidate_digest"
  rollback_kemerbet_recheck_final_binding ||
    die 'an uncommitted KemerBet identity binding could not be rolled back'
  if [[ -e "$KEMERBET_RECHECK_CANDIDATE_BINDING" || -L "$KEMERBET_RECHECK_CANDIDATE_BINDING" ]]; then
    [[ ! -L "$KEMERBET_RECHECK_CANDIDATE_BINDING" &&
      "$(stat --format='%d:%i:%s' "$KEMERBET_RECHECK_CANDIDATE_BINDING")" == \
        "$candidate_dev_ino:230" &&
      "$(sha256sum -- "$KEMERBET_RECHECK_CANDIDATE_BINDING" | awk '{print $1}')" == "$candidate_digest" ]] ||
      die 'the interrupted KemerBet candidate does not match its durable journal'
  fi
  remove_kemerbet_recheck_candidate || die 'the interrupted KemerBet candidate could not be removed'
  require_retryable_kemerbet_binding_source "$source_dev_ino" "$candidate_digest" ||
    die 'the interrupted KemerBet binding source is not directly retryable'
  consume_exact_one_use_kemerbet_file \
    "$KEMERBET_READINESS_PLAYER_IDS" "$player_ids_dev_ino" "$player_ids_digest" ||
    die 'the interrupted one-use KemerBet Player-ID source could not be removed'
  restore_retryable_owner_staged_kemerbet_cohort ||
    die 'the interrupted Owner KemerBet cohort could not be restored for retry'
  repair_kemerbet_identity_key_readability ||
    die 'the KemerBet identity key could not be repaired after interruption'
  [[ "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" == \
    "${journal_lines[6]#identity_hmac_key_sha256=}" ]] ||
    die 'the repaired KemerBet identity key no longer matches its journal'
  remove_owned_kemerbet_recheck_promotion_root ||
    die 'the interrupted KemerBet promotion journal could not be retired'
  KEMERBET_RECHECK_RECOVERY_OUTCOME='retryable'
  KEMERBET_RECHECK_CANDIDATE_DEV_INO=''
  KEMERBET_RECHECK_CANDIDATE_DIGEST=''
}

recover_kemerbet_recheck_before_teardown() {
  local fallback_durable_status=0 fallback_publish_status=0 fallback_status=0
  local latch_durable_status=0 latch_status=0 recovery_status=0
  KEMERBET_TEARDOWN_RECOVERY_FAILED='false'
  KEMERBET_EMERGENCY_TEARDOWN_FAILED='false'
  # The mutation lock is already held by every caller. The guarded recovery publishes a durable,
  # root-owned latch before its first recovery mutation. A pre-existing latch skips recovery.
  set +e
  ( set -e; recover_incomplete_kemerbet_recheck_promotion_guarded )
  recovery_status=$?
  set -e
  if [[ "$recovery_status" -eq 0 &&
    ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" ]]; then
    return 0
  fi
  set +e
  inspect_kemerbet_recovery_latch
  latch_status=$?
  set -e
  if [[ "$latch_status" -ne 1 ]]; then
    set +e
    ( set -e; durably_retain_kemerbet_recovery_latch_residue )
    latch_durable_status=$?
    set -e
  else
    latch_durable_status=1
  fi
  if [[ "$latch_durable_status" -ne 0 ]]; then
    set +e
    inspect_kemerbet_recovery_fallback
    fallback_status=$?
    set -e
    if [[ "$fallback_status" -eq 1 ]]; then
      # A primary-latch publisher that leaves no final or installer has not authorized recovery
      # mutation. Bind that exact untouched journal before emergency teardown. If neither durable
      # namespace can retain a residue, preserve the pre-recovery topology and refuse teardown.
      set +e
      ( set -e; publish_kemerbet_recovery_fallback )
      fallback_publish_status=$?
      set -e
      set +e
      inspect_kemerbet_recovery_fallback
      fallback_status=$?
      set -e
    fi
    if [[ "$fallback_publish_status" -eq 0 || "$fallback_status" -ne 1 ]]; then
      set +e
      ( set -e; durably_retain_kemerbet_recovery_fallback_residue )
      fallback_durable_status=$?
      set -e
    else
      fallback_durable_status=1
    fi
    [[ "$fallback_durable_status" -eq 0 ]] ||
      die 'KemerBet recovery could not retain a durable failure block; teardown was not attempted'
  fi
  KEMERBET_TEARDOWN_RECOVERY_FAILED='true'
  printf '%s\n' \
    'KemerBet readiness recovery is durably blocked; full emergency teardown will continue.' >&2
}

require_kemerbet_teardown_recovery_success() {
  if [[ "$KEMERBET_TEARDOWN_RECOVERY_FAILED" == 'true' ]]; then
    if [[ "$KEMERBET_EMERGENCY_TEARDOWN_FAILED" == 'true' ]]; then
      die 'emergency teardown is incomplete and the interrupted KemerBet readiness journal requires root remediation'
    fi
    die 'the full staging runtime was stopped, but the interrupted KemerBet readiness journal requires root remediation'
  fi
}

harden_kemerbet_identity_key() {
  local digest_before metadata parent
  parent="$(dirname -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")"
  [[ ! -L "$parent" && -d "$parent" && "$(realpath -- "$parent")" == "$parent" ]] ||
    die 'the KemerBet executor secret root is absent, symbolic, or noncanonical'
  [[ "$(stat --format='%U:%G:%a' "$parent")" == 'root:root:700' ]] ||
    die 'the KemerBet executor secret root is not root-managed mode 0700'
  require_kemerbet_identity_key_file "$KEMERBET_AGENT_IDENTITY_HMAC_KEY"
  [[ "$(stat --format='%h' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")" == '1' ]] ||
    die 'the KemerBet identity key has an unsafe hard-link count'
  digest_before="$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')"
  [[ "$digest_before" =~ ^[0-9a-f]{64}$ ]] || die 'the KemerBet identity key digest is invalid'
  metadata="$(stat --format='%u:%g:%a' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")"
  if [[ "$metadata" == '10001:10001:400' ]]; then
    chown root:root "$KEMERBET_AGENT_IDENTITY_HMAC_KEY"
    chmod 0444 "$KEMERBET_AGENT_IDENTITY_HMAC_KEY"
    sync -f "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" ||
      die 'the KemerBet identity key could not be synchronized after hardening'
  fi
  require_root_readable_immutable_file "$KEMERBET_AGENT_IDENTITY_HMAC_KEY"
  [[ "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" == "$digest_before" ]] ||
    die 'the KemerBet identity key changed while it was hardened'
}

harden_kemerbet_player_ids_file() {
  local digest_fd python_status
  [[ "$KEMERBET_RECHECK_PLAYER_IDS_DEV_INO" =~ ^[0-9]+:[0-9]+$ &&
    "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the journaled KemerBet Player-ID identity is invalid before hardening'
  exec {digest_fd}<<<"$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" ||
    die 'the private KemerBet Player-ID digest channel could not be opened'
  if env -i PATH="$SAFE_PATH" python3 -I - \
    "$KEMERBET_READINESS_PLAYER_IDS" "$KEMERBET_RECHECK_PLAYER_IDS_DEV_INO" \
    "$digest_fd" <<'PY'
import hashlib
import os
import re
import stat
import sys

DEV_INO = re.compile(r'([0-9]+):([0-9]+)')
DIGEST = re.compile(r'[0-9a-f]{64}')


def reject():
    raise RuntimeError()


def mode(value):
    return stat.S_IMODE(value.st_mode)


def read_private_digest(descriptor_text):
    if not descriptor_text.isascii() or not descriptor_text.isdecimal():
        reject()
    descriptor = int(descriptor_text, 10)
    if descriptor < 3 or descriptor > 1024:
        reject()
    try:
        content = os.read(descriptor, 66)
    finally:
        os.close(descriptor)
    if len(content) != 65 or not content.endswith(b'\n'):
        reject()
    try:
        value = content[:-1].decode('ascii')
    except UnicodeDecodeError:
        reject()
    if DIGEST.fullmatch(value) is None:
        reject()
    return value


def harden(path, identity_text, expected_digest):
    match = DEV_INO.fullmatch(identity_text)
    if (
        path != '/etc/fetanagent/executor-secrets/kemerbet_no_transfer_readiness_player_ids'
        or match is None
        or DIGEST.fullmatch(expected_digest) is None
    ):
        reject()
    identity = (int(match.group(1)), int(match.group(2)))
    directory = os.path.dirname(path)
    name = os.path.basename(path)
    directory_descriptor = os.open(
        directory,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
    )
    descriptor = None
    try:
        opened_directory = os.fstat(directory_descriptor)
        named_directory = os.lstat(directory)
        if (
            not stat.S_ISDIR(opened_directory.st_mode)
            or (opened_directory.st_dev, opened_directory.st_ino)
            != (named_directory.st_dev, named_directory.st_ino)
            or (opened_directory.st_uid, opened_directory.st_gid, mode(opened_directory))
            != (0, 0, 0o700)
            or named_directory.st_mode != opened_directory.st_mode
            or os.path.realpath(directory) != directory
        ):
            reject()
        named = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
        absolute = os.lstat(path)
        if (
            not stat.S_ISREG(named.st_mode)
            or (named.st_dev, named.st_ino) != identity
            or (absolute.st_dev, absolute.st_ino) != identity
            or named.st_mode != absolute.st_mode
            or named.st_uid != absolute.st_uid
            or named.st_gid != absolute.st_gid
            or named.st_nlink != 1
            or named.st_size != absolute.st_size
            or (named.st_uid, named.st_gid, mode(named))
            not in {
                (10001, 10001, 0o400),
                (10001, 10001, 0o444),
                (0, 0, 0o400),
                (0, 0, 0o444),
            }
        ):
            reject()
        descriptor = os.open(
            name,
            os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC,
            dir_fd=directory_descriptor,
        )
        opened = os.fstat(descriptor)
        content = os.pread(descriptor, opened.st_size + 1, 0)
        if (
            (opened.st_dev, opened.st_ino) != identity
            or opened.st_mode != named.st_mode
            or opened.st_uid != named.st_uid
            or opened.st_gid != named.st_gid
            or opened.st_nlink != 1
            or len(content) != opened.st_size
            or hashlib.sha256(content).hexdigest() != expected_digest
        ):
            reject()
        os.fchown(descriptor, 0, 0)
        os.fchmod(descriptor, 0o444)
        os.fsync(descriptor)
        hardened = os.fstat(descriptor)
        named_again = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
        if (
            (hardened.st_dev, hardened.st_ino) != identity
            or (hardened.st_uid, hardened.st_gid, mode(hardened), hardened.st_nlink)
            != (0, 0, 0o444, 1)
            or named_again.st_mode != hardened.st_mode
            or named_again.st_uid != hardened.st_uid
            or named_again.st_gid != hardened.st_gid
            or (named_again.st_dev, named_again.st_ino) != identity
            or hashlib.sha256(
                os.pread(descriptor, hardened.st_size + 1, 0)
            ).hexdigest() != expected_digest
        ):
            reject()
        os.fsync(directory_descriptor)
    finally:
        if descriptor is not None:
            os.close(descriptor)
        os.close(directory_descriptor)


try:
    if len(sys.argv) != 4:
        reject()
    harden(sys.argv[1], sys.argv[2], read_private_digest(sys.argv[3]))
except Exception:
    raise SystemExit(1)
PY
  then
    python_status=0
  else
    python_status=$?
  fi
  exec {digest_fd}<&- ||
    die 'the private KemerBet Player-ID digest channel could not be closed'
  [[ "$python_status" -eq 0 ]] ||
    die 'the KemerBet Player-ID file could not be hardened safely'
}

resolve_kemerbet_session_control_volume_mountpoint() {
  local mountpoint volume_contract volume_name
  volume_name="$(docker_local volume ls --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter 'label=com.docker.compose.volume=kemerbet_session_control')" ||
    die 'the KemerBet session-control volume inventory could not be inspected'
  [[ "$volume_name" == "$KEMERBET_SESSION_CONTROL_VOLUME" ]] ||
    die 'the KemerBet session-control volume identity is not exact'
  volume_contract="$(inspect_kemerbet_durable_volume_contract \
    "$volume_name" kemerbet_session_control)" ||
    die 'the KemerBet session-control volume contract is not exact'
  mountpoint="${volume_contract##*|}"
  [[ "$mountpoint" == /* && ! -L "$mountpoint" && -d "$mountpoint" ]] ||
    die 'the KemerBet session-control volume mountpoint is unsafe'
  [[ "$(realpath -- "$mountpoint")" == "$mountpoint" ]] ||
    die 'the KemerBet session-control volume mountpoint is not canonical'
  [[ "$(stat --format='%u:%g:%a' "$mountpoint")" == '10001:10001:700' ]] ||
    die 'the KemerBet session-control volume ownership or mode is unsafe'
  printf '%s' "$mountpoint"
}

resolve_kemerbet_session_control_volume_offline_mountpoint() {
  local holders mountpoint volume_contract
  volume_contract="$(inspect_kemerbet_durable_volume_contract \
    "$KEMERBET_SESSION_CONTROL_VOLUME" kemerbet_session_control)" || return 1
  holders="$(docker_local container ls --all --quiet \
    --filter "volume=$KEMERBET_SESSION_CONTROL_VOLUME")" || return 1
  [[ -z "$holders" ]] || return 1
  mountpoint="${volume_contract##*|}"
  [[ ! -L "$mountpoint" && -d "$mountpoint" &&
    "$(realpath -- "$mountpoint")" == "$mountpoint" &&
    "$(stat --format='%u:%g:%a:%h' "$mountpoint")" == '10001:10001:700:2' ]] ||
    return 1
  printf '%s' "$mountpoint"
}

require_owner_kemerbet_receipt_ancestors() {
  local ancestor
  for ancestor in / /var /var/lib; do
    [[ ! -L "$ancestor" && -d "$ancestor" && "$(realpath -- "$ancestor")" == "$ancestor" &&
      "$(stat --format='%u:%g:%a' "$ancestor")" == '0:0:755' ]] ||
      die 'a system ancestor is unsafe for the Owner KemerBet receipt boundary'
  done
}

require_owner_kemerbet_receipt_directory() {
  require_owner_kemerbet_receipt_ancestors || return 1
  [[ ! -L "$KEMERBET_OWNER_RECEIPT_PARENT" && -d "$KEMERBET_OWNER_RECEIPT_PARENT" &&
    "$(realpath -- "$KEMERBET_OWNER_RECEIPT_PARENT")" == "$KEMERBET_OWNER_RECEIPT_PARENT" &&
    "$(stat --format='%u:%g:%a' "$KEMERBET_OWNER_RECEIPT_PARENT")" == '0:0:755' ]] ||
    die 'the Owner KemerBet receipt parent is unsafe'
  [[ ! -L "$KEMERBET_OWNER_RECEIPT_ROOT" && -d "$KEMERBET_OWNER_RECEIPT_ROOT" &&
    "$(realpath -- "$KEMERBET_OWNER_RECEIPT_ROOT")" == "$KEMERBET_OWNER_RECEIPT_ROOT" &&
    "$(stat --format='%u:%g:%a' "$KEMERBET_OWNER_RECEIPT_ROOT")" == '0:0:755' ]] ||
    die 'the Owner KemerBet receipt root is unsafe'
}

require_owner_kemerbet_receipt_startup_state() {
  local claim_id entries entry final_count=0 path
  require_owner_kemerbet_receipt_directory || return 1
  entries="$(find -P "$KEMERBET_OWNER_RECEIPT_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" ||
    die 'the Owner KemerBet receipt root could not be inspected'
  if [[ -n "$entries" ]]; then
    while IFS= read -r entry; do
      path="$KEMERBET_OWNER_RECEIPT_ROOT/$entry"
      case "$entry" in
        "$KEMERBET_OWNER_IMPORTED_CLAIM_NAME"|"$KEMERBET_OWNER_COMPLETED_CLAIM_NAME"|"$KEMERBET_OWNER_FAILED_CLAIM_NAME")
          [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
            "$(stat --format='%u:%g:%a:%h:%s' "$path")" == '0:10001:440:1:37' ]] ||
            die 'an Owner KemerBet receipt has unsafe metadata'
          IFS= read -r claim_id <"$path" || die 'an Owner KemerBet receipt could not be read'
          [[ "$claim_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] ||
            die 'an Owner KemerBet receipt claim is invalid'
          cmp -s -- "$path" <(printf '%s\n' "$claim_id") ||
            die 'an Owner KemerBet receipt content is not exact'
          final_count=$((final_count + 1))
          ;;
        "$KEMERBET_OWNER_IMPORTED_CLAIM_INSTALLING_NAME"|"$KEMERBET_OWNER_COMPLETED_CLAIM_INSTALLING_NAME"|"$KEMERBET_OWNER_FAILED_CLAIM_INSTALLING_NAME")
          die 'an incomplete Owner KemerBet receipt installation blocks startup'
          ;;
        *) die 'the Owner KemerBet receipt root contains unexpected residue' ;;
      esac
    done <<<"$entries"
  fi
  [[ "$final_count" -le 1 ]] || die 'the Owner KemerBet receipt state is conflicting'
  require_owner_kemerbet_receipt_directory || return 1
}

ensure_owner_kemerbet_receipt_root() {
  require_owner_kemerbet_receipt_ancestors
  if [[ ! -e "$KEMERBET_OWNER_RECEIPT_PARENT" && ! -L "$KEMERBET_OWNER_RECEIPT_PARENT" ]]; then
    install -d -o root -g root -m 0755 "$KEMERBET_OWNER_RECEIPT_PARENT"
    sync -f /var/lib || die 'the Owner KemerBet receipt parent could not be synchronized'
  fi
  [[ ! -L "$KEMERBET_OWNER_RECEIPT_PARENT" && -d "$KEMERBET_OWNER_RECEIPT_PARENT" &&
    "$(realpath -- "$KEMERBET_OWNER_RECEIPT_PARENT")" == "$KEMERBET_OWNER_RECEIPT_PARENT" &&
    "$(stat --format='%u:%g:%a' "$KEMERBET_OWNER_RECEIPT_PARENT")" == '0:0:755' ]] ||
    die 'the Owner KemerBet receipt parent is unsafe'
  if [[ ! -e "$KEMERBET_OWNER_RECEIPT_ROOT" && ! -L "$KEMERBET_OWNER_RECEIPT_ROOT" ]]; then
    install -d -o root -g root -m 0755 "$KEMERBET_OWNER_RECEIPT_ROOT"
    sync -f "$KEMERBET_OWNER_RECEIPT_PARENT" ||
      die 'the Owner KemerBet receipt root installation could not be synchronized'
  fi
  require_owner_kemerbet_receipt_startup_state
}

require_legacy_owner_kemerbet_receipt_paths_absent() {
  local control_mountpoint legacy_path
  control_mountpoint="$(resolve_kemerbet_session_control_volume_mountpoint)" || return 1
  for legacy_path in \
    "$control_mountpoint/$KEMERBET_OWNER_IMPORTED_CLAIM_NAME" \
    "$control_mountpoint/$KEMERBET_OWNER_IMPORTED_CLAIM_INSTALLING_NAME" \
    "$control_mountpoint/$KEMERBET_OWNER_COMPLETED_CLAIM_NAME" \
    "$control_mountpoint/$KEMERBET_OWNER_COMPLETED_CLAIM_INSTALLING_NAME" \
    "$control_mountpoint/$KEMERBET_OWNER_FAILED_CLAIM_NAME" \
    "$control_mountpoint/$KEMERBET_OWNER_FAILED_CLAIM_INSTALLING_NAME" \
    "$control_mountpoint/$KEMERBET_RECOVERY_LATCH_NAME" \
    "$control_mountpoint/$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME"; do
    [[ ! -e "$legacy_path" && ! -L "$legacy_path" ]] ||
      die 'a legacy Owner-writable KemerBet receipt path blocks the root receipt boundary'
  done
}

require_single_owner_control_runtime_instance() {
  local all_bind_contracts all_container_ids_text bind_container bind_destination bind_rw bind_source
  local bind_source_canonical container_bind_contracts
  local holder_contracts owner_ids receipt_mount
  local -a all_container_ids=()
  owner_ids="$(docker_local container ls --all --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter 'label=com.docker.compose.service=owner-control')" ||
    die 'the Owner control container inventory could not be inspected'
  require_owner_kemerbet_receipt_directory || return 1
  [[ "$owner_ids" =~ ^[0-9a-f]{12,64}$ ]] ||
    die 'the reviewed runtime must contain exactly one Owner control container'
  [[ "$(docker_local container inspect "$owner_ids" \
    --format '{{ index .Config.Labels "com.docker.compose.project" }}|{{ index .Config.Labels "com.docker.compose.service" }}')" == \
    "$PROJECT_NAME|owner-control" ]] ||
    die 'the singular Owner control container labels are not exact'
  receipt_mount="$(docker_local container inspect "$owner_ids" --format \
    '{{range .Mounts}}{{if eq .Destination "/run/fetanagent-kemerbet-readiness-cohort-receipts"}}{{printf "%s|%s|%s|%t" .Type .Source .Destination .RW}}{{end}}{{end}}')" ||
    die 'the Owner KemerBet receipt mount could not be inspected'
  [[ "$receipt_mount" == \
    "bind|$KEMERBET_OWNER_RECEIPT_ROOT|$KEMERBET_OWNER_RECEIPT_CONTAINER_ROOT|false" ]] ||
    die 'the Owner KemerBet receipt mount contract is not exact'
  all_container_ids_text="$(docker_local container ls --all --quiet --no-trunc)" ||
    die 'the container inventory could not be inspected for Owner KemerBet receipt holders'
  if [[ -n "$all_container_ids_text" ]]; then
    mapfile -t all_container_ids <<<"$all_container_ids_text"
  fi
  holder_contracts=''
  all_bind_contracts=''
  if [[ "${#all_container_ids[@]}" -gt 0 ]]; then
    # Docker appends a separator newline for every inspected object. Inspecting several objects in
    # one template call therefore creates ambiguous blank records (especially for a container with
    # no binds). Inspect one exact container at a time and append only a nonempty complete output;
    # the rigid field classifier below continues to reject every partial record.
    for bind_container in "${all_container_ids[@]}"; do
      [[ "$bind_container" =~ ^[0-9a-f]{64}$ ]] ||
        die 'a container identity could not be safely classified'
      container_bind_contracts="$(docker_local container inspect "$bind_container" --format \
        '{{range .Mounts}}{{if eq .Type "bind"}}{{printf "%s|%s|%s|%t\n" $.Id .Source .Destination .RW}}{{end}}{{end}}')" ||
        die 'the Owner KemerBet receipt bind inventory could not be inspected'
      if [[ -n "$container_bind_contracts" ]]; then
        if [[ -n "$all_bind_contracts" ]]; then
          all_bind_contracts+=$'\n'
        fi
        all_bind_contracts+="$container_bind_contracts"
      fi
    done
    if [[ -n "$all_bind_contracts" ]]; then
      while IFS='|' read -r bind_container bind_source bind_destination bind_rw; do
        [[ "$bind_container" =~ ^[0-9a-f]{64}$ && "$bind_source" == /* &&
          "$bind_destination" == /* && "$bind_rw" =~ ^(true|false)$ ]] ||
          die 'a container bind mount could not be safely classified'
        bind_source_canonical="$(realpath -- "$bind_source")" ||
          die 'a container bind source could not be canonically resolved'
        [[ "$bind_source_canonical" == /* && ! -L "$bind_source_canonical" &&
          "$(realpath -- "$bind_source_canonical")" == "$bind_source_canonical" ]] ||
          die 'a container bind source is not canonical'
        if [[ "$bind_source_canonical" == '/' ||
          "$bind_source_canonical" == "$KEMERBET_OWNER_RECEIPT_ROOT" ||
          "$bind_source_canonical" == "$KEMERBET_OWNER_RECEIPT_ROOT/"* ||
          "$KEMERBET_OWNER_RECEIPT_ROOT" == "$bind_source_canonical/"* ]]; then
          holder_contracts+="$bind_container|bind|$bind_source_canonical|$bind_destination|$bind_rw"$'\n'
        fi
      done <<<"$all_bind_contracts"
      holder_contracts="${holder_contracts%$'\n'}"
    fi
  fi
  [[ "$holder_contracts" == \
    "$owner_ids|bind|$KEMERBET_OWNER_RECEIPT_ROOT|$KEMERBET_OWNER_RECEIPT_CONTAINER_ROOT|false" ]] ||
    die 'the Owner KemerBet receipt boundary overlaps an unexpected container bind'
  require_legacy_owner_kemerbet_receipt_paths_absent || return 1
}

require_owner_kemerbet_receipt_service_access() {
  local owner_id
  require_single_owner_control_runtime_instance || return 1
  owner_id="$(docker_local container ls --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter 'label=com.docker.compose.service=owner-control')" ||
    die 'the running Owner control container could not be inspected'
  [[ "$owner_id" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the exact Owner control container is not running'
  docker_local container exec "$owner_id" node -e \
    "const fs=require('node:fs');const p='$KEMERBET_OWNER_RECEIPT_CONTAINER_ROOT';fs.readdirSync(p);fs.accessSync(p,fs.constants.R_OK|fs.constants.X_OK);try{fs.accessSync(p,fs.constants.W_OK);process.exit(1)}catch(e){if(!e||!['EACCES','EPERM','EROFS'].includes(e.code))process.exit(1)}" \
    >/dev/null 2>&1 || die 'the Owner process receipt mount is not read-only and traversable'
}

require_owner_kemerbet_failed_marker_read_only() {
  local claim_id="$1"
  [[ "$claim_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] ||
    return 1
  require_owner_kemerbet_receipt_directory || return 1
  require_legacy_owner_kemerbet_receipt_paths_absent || return 1
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$KEMERBET_OWNER_RECEIPT_ROOT" "$KEMERBET_OWNER_FAILED_CLAIM_NAME" \
    "$claim_id" <<'PY'
import os
import re
import stat
import sys

CLAIM = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}')


def reject():
    raise RuntimeError()


def exact_mode(value):
    return stat.S_IMODE(value.st_mode)


def read_exact(directory_fd, name, expected_owner, expected_mode, expected_content):
    before = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
    if (
        not stat.S_ISREG(before.st_mode)
        or (before.st_uid, before.st_gid) != expected_owner
        or exact_mode(before) != expected_mode
        or before.st_nlink != 1
        or before.st_size != len(expected_content)
    ):
        reject()
    descriptor = os.open(
        name,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=directory_fd,
    )
    try:
        opened = os.fstat(descriptor)
        content = os.pread(descriptor, len(expected_content) + 1, 0)
    finally:
        os.close(descriptor)
    after = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
    for observed in (opened, after):
        if (
            observed.st_mode != before.st_mode
            or observed.st_uid != before.st_uid
            or observed.st_gid != before.st_gid
            or observed.st_nlink != before.st_nlink
            or observed.st_size != before.st_size
            or (observed.st_dev, observed.st_ino) != (before.st_dev, before.st_ino)
        ):
            reject()
    if content != expected_content:
        reject()


try:
    if len(sys.argv) != 4:
        reject()
    root, failed_name, claim_id = sys.argv[1:]
    if (
        os.path.realpath(root) != root
        or failed_name != 'kemerbet-readiness-cohort-failed-v1'
        or CLAIM.fullmatch(claim_id) is None
    ):
        reject()
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    root_fd = os.open(root, flags)
    try:
        root_before = os.fstat(root_fd)
        named_root = os.lstat(root)
        if (
            not stat.S_ISDIR(root_before.st_mode)
            or (root_before.st_dev, root_before.st_ino)
            != (named_root.st_dev, named_root.st_ino)
            or (root_before.st_uid, root_before.st_gid, exact_mode(root_before))
            != (0, 0, 0o755)
            or named_root.st_mode != root_before.st_mode
        ):
            reject()
        entries = sorted(os.listdir(root_fd))
        if entries != [failed_name]:
            reject()
        read_exact(root_fd, failed_name, (0, 10001), 0o440, (claim_id + '\n').encode('ascii'))
        if sorted(os.listdir(root_fd)) != entries:
            reject()
        root_after = os.fstat(root_fd)
        if (
            root_after.st_mode != root_before.st_mode
            or root_after.st_uid != root_before.st_uid
            or root_after.st_gid != root_before.st_gid
            or (root_after.st_dev, root_after.st_ino)
            != (root_before.st_dev, root_before.st_ino)
        ):
            reject()
    finally:
        os.close(root_fd)
except Exception:
    raise SystemExit(1)
PY
}

inspect_owner_staged_kemerbet_cohort() {
  local access_policy="${1:-online}" claim_path claim_size control_mountpoint inspection
  local installing_path player_path player_size project_containers
  local -a inspection_lines=()
  case "$access_policy" in
    online)
      require_single_owner_control_runtime_instance || return 1
      control_mountpoint="$(resolve_kemerbet_session_control_volume_mountpoint)" || return 1
      ;;
    offline)
      project_containers="$(docker_local container ls --all --quiet \
        --filter "label=com.docker.compose.project=$PROJECT_NAME")" || return 1
      [[ -z "$project_containers" ]] || return 1
      control_mountpoint="$(resolve_kemerbet_session_control_volume_offline_mountpoint)" || return 1
      require_owner_kemerbet_receipt_directory || return 1
      require_legacy_owner_kemerbet_receipt_paths_absent || return 1
      ;;
    *) return 1 ;;
  esac
  player_path="$control_mountpoint/$KEMERBET_OWNER_STAGED_PLAYER_IDS_NAME"
  claim_path="$control_mountpoint/$KEMERBET_OWNER_STAGED_CLAIM_NAME"
  for installing_path in \
    "$control_mountpoint/$KEMERBET_OWNER_STAGED_PLAYER_IDS_INSTALLING_NAME" \
    "$control_mountpoint/$KEMERBET_OWNER_STAGED_CLAIM_INSTALLING_NAME" \
    "$control_mountpoint/$KEMERBET_OWNER_IMPORTED_CLAIM_INSTALLING_NAME" \
    "$control_mountpoint/$KEMERBET_OWNER_COMPLETED_CLAIM_INSTALLING_NAME" \
    "$control_mountpoint/$KEMERBET_OWNER_FAILED_CLAIM_INSTALLING_NAME"; do
    [[ ! -e "$installing_path" && ! -L "$installing_path" ]] ||
      die 'the Owner-staged KemerBet cohort has an incomplete fixed installation'
  done
  [[ ! -e "$control_mountpoint/$KEMERBET_OWNER_IMPORTED_CLAIM_NAME" &&
    ! -L "$control_mountpoint/$KEMERBET_OWNER_IMPORTED_CLAIM_NAME" &&
    ! -e "$control_mountpoint/$KEMERBET_OWNER_COMPLETED_CLAIM_NAME" &&
    ! -L "$control_mountpoint/$KEMERBET_OWNER_COMPLETED_CLAIM_NAME" ]] ||
    die 'the Owner-staged KemerBet cohort has an incompatible claim marker'
  [[ ! -e "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_IMPORTED_CLAIM_NAME" &&
    ! -L "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_IMPORTED_CLAIM_NAME" &&
    ! -e "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_COMPLETED_CLAIM_NAME" &&
    ! -L "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_COMPLETED_CLAIM_NAME" ]] ||
    die 'the Owner-staged KemerBet cohort has an incompatible root receipt'
  for staged_path in "$player_path" "$claim_path"; do
    [[ ! -L "$staged_path" && -f "$staged_path" && "$(realpath -- "$staged_path")" == "$staged_path" &&
      "$(stat --format='%u:%g:%a:%h' "$staged_path")" == '10001:10001:400:1' ]] ||
      die 'the Owner-staged KemerBet cohort file ownership or mode is unsafe'
  done
  player_size="$(stat --format='%s' "$player_path")"
  claim_size="$(stat --format='%s' "$claim_path")"
  [[ "$player_size" =~ ^[0-9]+$ && "$player_size" -ge 10 && "$player_size" -le 1024 ]] ||
    die 'the Owner-staged KemerBet Player-ID cohort size is invalid'
  [[ "$claim_size" == '37' ]] || die 'the Owner-staged KemerBet claim size is invalid'
  IFS= read -r KEMERBET_RECHECK_OWNER_CLAIM_ID <"$claim_path" ||
    die 'the Owner-staged KemerBet claim could not be read'
  [[ "$KEMERBET_RECHECK_OWNER_CLAIM_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] ||
    die 'the Owner-staged KemerBet claim identity is invalid'
  cmp -s -- "$claim_path" <(printf '%s\n' "$KEMERBET_RECHECK_OWNER_CLAIM_ID") ||
    die 'the Owner-staged KemerBet claim content is not exact'
  if [[ -e "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_FAILED_CLAIM_NAME" ||
    -L "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_FAILED_CLAIM_NAME" ]]; then
    if [[ "$access_policy" == 'offline' ]]; then
      require_owner_kemerbet_failed_marker_read_only "$KEMERBET_RECHECK_OWNER_CLAIM_ID" ||
        die 'the offline Owner-staged KemerBet failure marker does not match its claim'
    else
      owner_kemerbet_cohort_marker require-failed "$KEMERBET_RECHECK_OWNER_CLAIM_ID" ||
        die 'the retryable Owner-staged KemerBet failure marker does not match its claim'
    fi
  fi
  inspection="$(env -i PATH="$SAFE_PATH" python3 -I - \
    "$player_path" "$claim_path" "$KEMERBET_RECHECK_OWNER_CLAIM_ID" <<'PY'
import hashlib
import os
import re
import stat
import sys

PLAYER_ID = re.compile(rb'[A-Za-z0-9][A-Za-z0-9._-]{0,63}')
CLAIM_ID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}')


def reject():
    raise RuntimeError()


def mode(value):
    return stat.S_IMODE(value.st_mode)


def open_exact(directory_descriptor, path, player):
    name = os.path.basename(path)
    relative = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
    absolute = os.lstat(path)
    if (
        not stat.S_ISREG(relative.st_mode)
        or (relative.st_dev, relative.st_ino) != (absolute.st_dev, absolute.st_ino)
        or relative.st_mode != absolute.st_mode
        or relative.st_uid != absolute.st_uid
        or relative.st_gid != absolute.st_gid
        or (relative.st_uid, relative.st_gid, mode(relative), relative.st_nlink)
        != (10001, 10001, 0o400, 1)
        or relative.st_size != absolute.st_size
        or relative.st_size < (10 if player else 37)
        or relative.st_size > (1024 if player else 37)
    ):
        reject()
    descriptor = os.open(
        name,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=directory_descriptor,
    )
    opened = os.fstat(descriptor)
    content = os.pread(descriptor, relative.st_size + 1, 0)
    if (
        (opened.st_dev, opened.st_ino) != (relative.st_dev, relative.st_ino)
        or opened.st_mode != relative.st_mode
        or opened.st_uid != relative.st_uid
        or opened.st_gid != relative.st_gid
        or opened.st_nlink != 1
        or opened.st_size != relative.st_size
        or len(content) != relative.st_size
    ):
        os.close(descriptor)
        reject()
    return descriptor, opened, content


def inspect(player_path, claim_path, claim_id):
    if (
        os.path.basename(player_path) != 'kemerbet-readiness-player-ids.stage-v1'
        or os.path.basename(claim_path) != 'kemerbet-readiness-cohort-claim.stage-v1'
        or os.path.dirname(player_path) != os.path.dirname(claim_path)
        or CLAIM_ID.fullmatch(claim_id) is None
    ):
        reject()
    directory = os.path.dirname(player_path)
    directory_descriptor = os.open(
        directory,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
    )
    player_descriptor = None
    claim_descriptor = None
    try:
        opened_directory = os.fstat(directory_descriptor)
        named_directory = os.lstat(directory)
        if (
            not stat.S_ISDIR(opened_directory.st_mode)
            or (opened_directory.st_dev, opened_directory.st_ino)
            != (named_directory.st_dev, named_directory.st_ino)
            or (opened_directory.st_uid, opened_directory.st_gid, mode(opened_directory))
            != (10001, 10001, 0o700)
            or named_directory.st_mode != opened_directory.st_mode
            or os.path.realpath(directory) != directory
        ):
            reject()
        player_descriptor, player, player_content = open_exact(
            directory_descriptor, player_path, True
        )
        claim_descriptor, claim, claim_content = open_exact(
            directory_descriptor, claim_path, False
        )
        lines = player_content[:-1].split(b'\n') if player_content.endswith(b'\n') else []
        if (
            b'\r' in player_content
            or b'\0' in player_content
            or len(lines) != 5
            or len(set(lines)) != 5
            or any(PLAYER_ID.fullmatch(line) is None for line in lines)
            or claim_content != (claim_id + '\n').encode('ascii')
        ):
            reject()
        for descriptor, opened, path in (
            (player_descriptor, player, player_path),
            (claim_descriptor, claim, claim_path),
        ):
            named = os.stat(
                os.path.basename(path),
                dir_fd=directory_descriptor,
                follow_symlinks=False,
            )
            if (
                (named.st_dev, named.st_ino) != (opened.st_dev, opened.st_ino)
                or named.st_mode != opened.st_mode
                or named.st_uid != opened.st_uid
                or named.st_gid != opened.st_gid
                or os.fstat(descriptor).st_mode != opened.st_mode
            ):
                reject()
        return (
            f'{player.st_dev}:{player.st_ino}',
            f'{claim.st_dev}:{claim.st_ino}',
            hashlib.sha256(player_content).hexdigest(),
        )
    finally:
        if claim_descriptor is not None:
            os.close(claim_descriptor)
        if player_descriptor is not None:
            os.close(player_descriptor)
        os.close(directory_descriptor)


try:
    if len(sys.argv) != 4:
        reject()
    values = inspect(sys.argv[1], sys.argv[2], sys.argv[3])
    sys.stdout.write('\n'.join(values) + '\n')
except Exception:
    raise SystemExit(1)
PY
)" || die 'the Owner-staged KemerBet cohort could not be inspected safely'
  mapfile -t inspection_lines <<<"$inspection"
  [[ "${#inspection_lines[@]}" -eq 3 ]] ||
    die 'the Owner-staged KemerBet cohort inspection result is invalid'
  KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO="${inspection_lines[0]}"
  KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO="${inspection_lines[1]}"
  KEMERBET_RECHECK_PLAYER_IDS_DIGEST="${inspection_lines[2]}"
  [[ "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" =~ ^[0-9]+:[0-9]+$ &&
    "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" =~ ^[0-9]+:[0-9]+$ &&
    "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the Owner-staged KemerBet cohort file identity is invalid'
  [[ "$(stat --format='%d:%i:%u:%g:%a:%h:%s' "$player_path")" == \
    "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO:10001:10001:400:1:$player_size" &&
    "$(sha256sum -- "$player_path" | awk '{print $1}')" == "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" &&
    "$(stat --format='%d:%i:%u:%g:%a:%h:%s' "$claim_path")" == \
    "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO:10001:10001:400:1:37" ]] ||
    die 'the Owner-staged KemerBet cohort changed during inspection'
}

inspect_owner_staged_kemerbet_cohort_for_retirement_context() {
  local project_containers
  project_containers="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")" || return 1
  if [[ -z "$project_containers" ]]; then
    inspect_owner_staged_kemerbet_cohort offline
  else
    inspect_owner_staged_kemerbet_cohort online
  fi
}

prepare_retryable_kemerbet_session_player_ids() {
  local commit_sha="$1"
  local after_claim_dev_ino after_claim_id after_digest after_player_dev_ino
  local before_claim_dev_ino before_claim_id before_digest before_player_dev_ino
  local binding_size candidate_path claim_source control_mountpoint failed_installing_path
  local failed_path metadata_fd migration_awaiting='false' python_status source
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
    die 'the retryable KemerBet session release identity is invalid'

  failed_path="$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_FAILED_CLAIM_NAME"
  failed_installing_path="$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_FAILED_CLAIM_INSTALLING_NAME"
  candidate_path="$(dirname -- "$KEMERBET_READINESS_PLAYER_IDS")/.kemerbet-readiness-player-ids.promote-v1"

  if [[ -e "$KEMERBET_READINESS_PLAYER_IDS" || -L "$KEMERBET_READINESS_PLAYER_IDS" ]]; then
    require_service_file "$KEMERBET_READINESS_PLAYER_IDS"
    if [[ ! -e "$failed_path" && ! -L "$failed_path" &&
      ! -e "$failed_installing_path" && ! -L "$failed_installing_path" &&
      ! -e "$candidate_path" && ! -L "$candidate_path" ]]; then
      [[ "$(stat --format='%h' "$KEMERBET_READINESS_PLAYER_IDS")" == '1' ]] ||
        die 'the private KemerBet session Player-ID file has an unsafe hard-link count'
      if [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" != 'absent' ]]; then
        [[ ! -L "$KEMERBET_READINESS_BINDING" && -f "$KEMERBET_READINESS_BINDING" &&
          "$(realpath -- "$KEMERBET_READINESS_BINDING")" == "$KEMERBET_READINESS_BINDING" &&
          "$(stat --format='%u:%g:%a:%h:%s' "$KEMERBET_READINESS_BINDING")" == \
            '10001:10001:600:1:230' ]] ||
          die 'the retryable KemerBet v3 binding is unavailable or unsafe'
        require_kemerbet_v3_binding_content "$KEMERBET_READINESS_BINDING" ||
          die 'the retryable KemerBet v3 binding contract changed'
        inspect_kemerbet_v2_v3_successor_gate
        [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'successor-installed' &&
          "$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$commit_sha" ]] ||
          die 'the retryable Player-ID input no longer matches the same-release KemerBet v3 successor'
      fi
      return 0
    fi
  fi

  # A failed one-shot recheck consumes its internal Player-ID copy before restoring the same
  # immutable Owner cohort for retry. Reopen sign-in only from that exact failed cohort. This
  # creates a new service copy without changing either Owner-stage inode, ownership, content, or
  # claim marker; the next recheck will independently freeze and consume the copy again.
  [[ ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    ! -e "$KEMERBET_RECHECK_RECEIPT_ROOT" && ! -L "$KEMERBET_RECHECK_RECEIPT_ROOT" &&
    ! -e "$KEMERBET_RECHECK_CANDIDATE_ROOT" && ! -L "$KEMERBET_RECHECK_CANDIDATE_ROOT" &&
    ! -e "$KEMERBET_AGENT_IDENTITY_BINDINGS" && ! -L "$KEMERBET_AGENT_IDENTITY_BINDINGS" &&
    ! -e "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_NAME" &&
    ! -L "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_NAME" &&
    ! -e "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME" &&
    ! -L "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME" &&
    ! -e "$failed_installing_path" && ! -L "$failed_installing_path" ]] ||
    die 'the retryable KemerBet session boundary contains recovery or committed residue'
  require_kemerbet_readiness_output_directory
  if [[ -e "$KEMERBET_READINESS_BINDING" || -L "$KEMERBET_READINESS_BINDING" ]]; then
    [[ ! -L "$KEMERBET_READINESS_BINDING" && -f "$KEMERBET_READINESS_BINDING" &&
      "$(realpath -- "$KEMERBET_READINESS_BINDING")" == "$KEMERBET_READINESS_BINDING" &&
      "$(stat --format='%u:%g:%a:%h' "$KEMERBET_READINESS_BINDING")" == '10001:10001:600:1' ]] ||
      die 'the sealed KemerBet readiness binding is unavailable or unsafe for retry'
    binding_size="$(stat --format='%s' "$KEMERBET_READINESS_BINDING")"
    [[ "$binding_size" == '230' &&
      "$(wc -l <"$KEMERBET_READINESS_BINDING")" == '1' ]] ||
      die 'the sealed KemerBet readiness binding shape is invalid for retry'
    require_kemerbet_v3_binding_content "$KEMERBET_READINESS_BINDING" ||
      die 'the sealed KemerBet v3 readiness binding contract is invalid for retry'
  else
    migration_awaiting='true'
  fi
  inspect_owner_staged_kemerbet_cohort
  before_player_dev_ino="$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO"
  before_claim_dev_ino="$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO"
  before_claim_id="$KEMERBET_RECHECK_OWNER_CLAIM_ID"
  before_digest="$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"
  owner_kemerbet_cohort_marker require-failed "$before_claim_id" ||
    die 'the retryable KemerBet cohort failure marker is unavailable'
  if [[ "$migration_awaiting" == 'true' ]]; then
    require_kemerbet_v1_retired_awaiting_v2 "$commit_sha" ||
      die 'an empty retry binding is not an exact explicitly retired v1 awaiting v2 reseal'
  fi

  command -v python3 >/dev/null 2>&1 ||
    die 'the retryable KemerBet session input verifier is unavailable'
  control_mountpoint="$(resolve_kemerbet_session_control_volume_mountpoint)"
  source="$control_mountpoint/$KEMERBET_OWNER_STAGED_PLAYER_IDS_NAME"
  claim_source="$control_mountpoint/$KEMERBET_OWNER_STAGED_CLAIM_NAME"
  exec {metadata_fd}<<<"$before_claim_id
$before_digest" ||
    die 'the private retryable KemerBet cohort metadata channel could not be opened'
  if env -i PATH="$SAFE_PATH" python3 -I - \
    "$source" "$claim_source" "$KEMERBET_READINESS_PLAYER_IDS" \
    "$before_player_dev_ino" "$before_claim_dev_ino" "$metadata_fd" <<'PY'
import hashlib
import os
import re
import stat
import sys

EXPECTED_SOURCE_NAME = 'kemerbet-readiness-player-ids.stage-v1'
EXPECTED_CLAIM_NAME = 'kemerbet-readiness-cohort-claim.stage-v1'
EXPECTED_TARGET = '/etc/fetanagent/executor-secrets/kemerbet_no_transfer_readiness_player_ids'
CANDIDATE_NAME = '.kemerbet-readiness-player-ids.promote-v1'
PLAYER_ID = re.compile(rb'[A-Za-z0-9][A-Za-z0-9._-]{0,63}')
CLAIM_ID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}')
DEV_INO = re.compile(r'([0-9]+):([0-9]+)')
DIGEST = re.compile(r'[0-9a-f]{64}')
MAXIMUM_BYTES = 1024


def reject():
    raise RuntimeError()


def exact_mode(value):
    return stat.S_IMODE(value.st_mode)


def read_private_metadata(descriptor_text):
    if not descriptor_text.isascii() or not descriptor_text.isdecimal():
        reject()
    descriptor = int(descriptor_text, 10)
    if descriptor < 3 or descriptor > 1024:
        reject()
    try:
        content = os.read(descriptor, 103)
    finally:
        os.close(descriptor)
    if len(content) != 102 or not content.endswith(b'\n'):
        reject()
    try:
        values = content[:-1].decode('ascii').split('\n')
    except UnicodeDecodeError:
        reject()
    if (
        len(values) != 2
        or CLAIM_ID.fullmatch(values[0]) is None
        or DIGEST.fullmatch(values[1]) is None
    ):
        reject()
    return values[0], values[1]


def parse_identity(value):
    match = DEV_INO.fullmatch(value)
    if match is None:
        reject()
    return int(match.group(1)), int(match.group(2))


def validate_player_content(content):
    if len(content) < 10 or len(content) > MAXIMUM_BYTES:
        reject()
    if not content.endswith(b'\n') or b'\r' in content or b'\0' in content:
        reject()
    lines = content[:-1].split(b'\n')
    if len(lines) != 5 or len(set(lines)) != 5:
        reject()
    if any(PLAYER_ID.fullmatch(line) is None for line in lines):
        reject()


def open_exact_directory(path, expected_uid, expected_gid, expected_mode):
    descriptor = os.open(
        path,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
    )
    try:
        opened = os.fstat(descriptor)
        named = os.lstat(path)
        if (
            not stat.S_ISDIR(opened.st_mode)
            or not stat.S_ISDIR(named.st_mode)
            or (opened.st_dev, opened.st_ino) != (named.st_dev, named.st_ino)
            or (opened.st_uid, opened.st_gid, exact_mode(opened))
            != (expected_uid, expected_gid, expected_mode)
            or opened.st_mode != named.st_mode
            or opened.st_uid != named.st_uid
            or opened.st_gid != named.st_gid
            or os.path.realpath(path) != path
        ):
            reject()
        return descriptor
    except Exception:
        os.close(descriptor)
        raise


def optional_named_file(directory_descriptor, name, path):
    try:
        relative = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
    except FileNotFoundError:
        try:
            os.lstat(path)
        except FileNotFoundError:
            return None
        reject()
    absolute = os.lstat(path)
    if (
        (relative.st_dev, relative.st_ino) != (absolute.st_dev, absolute.st_ino)
        or relative.st_mode != absolute.st_mode
        or relative.st_uid != absolute.st_uid
        or relative.st_gid != absolute.st_gid
        or relative.st_nlink != absolute.st_nlink
        or relative.st_size != absolute.st_size
    ):
        reject()
    return relative


def read_exact_file(directory_descriptor, name, path, expected_metadata, expected_content):
    named = optional_named_file(directory_descriptor, name, path)
    expected_uid, expected_gid, expected_mode, expected_links = expected_metadata
    if (
        named is None
        or not stat.S_ISREG(named.st_mode)
        or (named.st_uid, named.st_gid, exact_mode(named), named.st_nlink)
        != (expected_uid, expected_gid, expected_mode, expected_links)
        or named.st_size != len(expected_content)
    ):
        reject()
    descriptor = os.open(
        name,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=directory_descriptor,
    )
    try:
        opened = os.fstat(descriptor)
        if (
            (opened.st_dev, opened.st_ino) != (named.st_dev, named.st_ino)
            or opened.st_mode != named.st_mode
            or opened.st_uid != named.st_uid
            or opened.st_gid != named.st_gid
            or opened.st_nlink != named.st_nlink
            or opened.st_size != named.st_size
            or os.pread(descriptor, len(expected_content) + 1, 0) != expected_content
        ):
            reject()
        return descriptor, (opened.st_dev, opened.st_ino)
    except Exception:
        os.close(descriptor)
        raise


def read_exact_source(directory_descriptor, name, path, expected_identity):
    named = optional_named_file(directory_descriptor, name, path)
    if (
        named is None
        or not stat.S_ISREG(named.st_mode)
        or (named.st_dev, named.st_ino) != expected_identity
        or (named.st_uid, named.st_gid, exact_mode(named), named.st_nlink)
        != (10001, 10001, 0o400, 1)
        or named.st_size < 10
        or named.st_size > MAXIMUM_BYTES
    ):
        reject()
    descriptor = os.open(
        name,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=directory_descriptor,
    )
    try:
        opened = os.fstat(descriptor)
        if (
            (opened.st_dev, opened.st_ino) != expected_identity
            or opened.st_mode != named.st_mode
            or opened.st_uid != named.st_uid
            or opened.st_gid != named.st_gid
            or opened.st_nlink != 1
            or opened.st_size != named.st_size
        ):
            reject()
        content = os.pread(descriptor, MAXIMUM_BYTES + 1, 0)
        if len(content) != opened.st_size:
            reject()
        validate_player_content(content)
        return descriptor, content
    except Exception:
        os.close(descriptor)
        raise


def require_source_unchanged(
    descriptor,
    directory_descriptor,
    name,
    path,
    expected_identity,
    expected_content,
):
    opened = os.fstat(descriptor)
    named = optional_named_file(directory_descriptor, name, path)
    if (
        named is None
        or (opened.st_dev, opened.st_ino) != expected_identity
        or (named.st_dev, named.st_ino) != expected_identity
        or opened.st_mode != named.st_mode
        or opened.st_uid != named.st_uid
        or opened.st_gid != named.st_gid
        or opened.st_nlink != named.st_nlink
        or opened.st_size != named.st_size
        or (opened.st_uid, opened.st_gid, exact_mode(opened), opened.st_nlink)
        != (10001, 10001, 0o400, 1)
        or os.pread(descriptor, len(expected_content) + 1, 0) != expected_content
    ):
        reject()


def remove_safe_candidate(
    directory_descriptor,
    candidate_name,
    candidate_path,
    source_content,
):
    candidate = optional_named_file(directory_descriptor, candidate_name, candidate_path)
    if candidate is None:
        return
    if (
        not stat.S_ISREG(candidate.st_mode)
        or candidate.st_nlink != 1
        or candidate.st_size > len(source_content)
        or (candidate.st_uid, candidate.st_gid, exact_mode(candidate))
        not in {(0, 0, 0o600), (10001, 10001, 0o600), (10001, 10001, 0o400)}
    ):
        reject()
    descriptor = os.open(
        candidate_name,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=directory_descriptor,
    )
    try:
        opened = os.fstat(descriptor)
        content = os.pread(descriptor, len(source_content) + 1, 0)
        if (
            (opened.st_dev, opened.st_ino) != (candidate.st_dev, candidate.st_ino)
            or opened.st_mode != candidate.st_mode
            or opened.st_uid != candidate.st_uid
            or opened.st_gid != candidate.st_gid
            or opened.st_nlink != 1
            or opened.st_size != candidate.st_size
            or content != source_content[: len(content)]
        ):
            reject()
    finally:
        os.close(descriptor)
    os.unlink(candidate_name, dir_fd=directory_descriptor)
    os.fsync(directory_descriptor)
    if optional_named_file(directory_descriptor, candidate_name, candidate_path) is not None:
        reject()


def write_all(descriptor, content):
    offset = 0
    while offset < len(content):
        written = os.write(descriptor, content[offset:])
        if written < 1:
            reject()
        offset += written


def prepare(
    source,
    claim_source,
    target,
    expected_identity_text,
    expected_claim_identity_text,
    expected_claim_id,
    expected_digest,
):
    if (
        os.path.basename(source) != EXPECTED_SOURCE_NAME
        or os.path.basename(claim_source) != EXPECTED_CLAIM_NAME
        or target != EXPECTED_TARGET
        or os.path.basename(target) != 'kemerbet_no_transfer_readiness_player_ids'
        or CLAIM_ID.fullmatch(expected_claim_id) is None
        or DIGEST.fullmatch(expected_digest) is None
    ):
        reject()
    expected_identity = parse_identity(expected_identity_text)
    expected_claim_identity = parse_identity(expected_claim_identity_text)
    source_parent = os.path.dirname(source)
    source_name = os.path.basename(source)
    claim_parent = os.path.dirname(claim_source)
    claim_name = os.path.basename(claim_source)
    if claim_parent != source_parent:
        reject()
    claim_content = expected_claim_id.encode('ascii') + b'\n'
    target_parent = os.path.dirname(target)
    target_name = os.path.basename(target)
    candidate_path = os.path.join(target_parent, CANDIDATE_NAME)
    source_directory_descriptor = open_exact_directory(source_parent, 10001, 10001, 0o700)
    target_directory_descriptor = open_exact_directory(target_parent, 0, 0, 0o700)
    source_descriptor = None
    claim_descriptor = None
    candidate_descriptor = None
    target_descriptor = None
    try:
        source_descriptor, source_content = read_exact_source(
            source_directory_descriptor,
            source_name,
            source,
            expected_identity,
        )
        if hashlib.sha256(source_content).hexdigest() != expected_digest:
            reject()
        claim_descriptor, claim_identity = read_exact_file(
            source_directory_descriptor,
            claim_name,
            claim_source,
            (10001, 10001, 0o400, 1),
            claim_content,
        )
        if claim_identity != expected_claim_identity:
            reject()

        target_value = optional_named_file(target_directory_descriptor, target_name, target)
        candidate_value = optional_named_file(
            target_directory_descriptor,
            CANDIDATE_NAME,
            candidate_path,
        )
        if target_value is not None:
            target_descriptor, target_identity = read_exact_file(
                target_directory_descriptor,
                target_name,
                target,
                (10001, 10001, 0o400, target_value.st_nlink),
                source_content,
            )
            if target_value.st_nlink == 2 and candidate_value is not None:
                candidate_descriptor, candidate_identity = read_exact_file(
                    target_directory_descriptor,
                    CANDIDATE_NAME,
                    candidate_path,
                    (10001, 10001, 0o400, 2),
                    source_content,
                )
                if candidate_identity != target_identity:
                    reject()
                os.close(candidate_descriptor)
                candidate_descriptor = None
                os.unlink(CANDIDATE_NAME, dir_fd=target_directory_descriptor)
                os.fsync(target_directory_descriptor)
            elif target_value.st_nlink == 1:
                remove_safe_candidate(
                    target_directory_descriptor,
                    CANDIDATE_NAME,
                    candidate_path,
                    source_content,
                )
            else:
                reject()
        else:
            remove_safe_candidate(
                target_directory_descriptor,
                CANDIDATE_NAME,
                candidate_path,
                source_content,
            )
            candidate_descriptor = os.open(
                CANDIDATE_NAME,
                os.O_RDWR
                | os.O_CREAT
                | os.O_EXCL
                | os.O_NOFOLLOW
                | os.O_CLOEXEC,
                0o600,
                dir_fd=target_directory_descriptor,
            )
            write_all(candidate_descriptor, source_content)
            os.fchown(candidate_descriptor, 10001, 10001)
            os.fchmod(candidate_descriptor, 0o400)
            os.fsync(candidate_descriptor)
            candidate_identity = os.fstat(candidate_descriptor)
            read_descriptor, read_identity = read_exact_file(
                target_directory_descriptor,
                CANDIDATE_NAME,
                candidate_path,
                (10001, 10001, 0o400, 1),
                source_content,
            )
            os.close(read_descriptor)
            if read_identity != (candidate_identity.st_dev, candidate_identity.st_ino):
                reject()
            require_source_unchanged(
                source_descriptor,
                source_directory_descriptor,
                source_name,
                source,
                expected_identity,
                source_content,
            )
            require_source_unchanged(
                claim_descriptor,
                source_directory_descriptor,
                claim_name,
                claim_source,
                expected_claim_identity,
                claim_content,
            )
            os.link(
                CANDIDATE_NAME,
                target_name,
                src_dir_fd=target_directory_descriptor,
                dst_dir_fd=target_directory_descriptor,
                follow_symlinks=False,
            )
            os.fsync(target_directory_descriptor)
            target_descriptor, target_identity = read_exact_file(
                target_directory_descriptor,
                target_name,
                target,
                (10001, 10001, 0o400, 2),
                source_content,
            )
            if target_identity != (candidate_identity.st_dev, candidate_identity.st_ino):
                reject()
            os.unlink(CANDIDATE_NAME, dir_fd=target_directory_descriptor)
            os.fsync(target_directory_descriptor)

        if target_descriptor is not None:
            os.close(target_descriptor)
            target_descriptor = None
        final_descriptor, _ = read_exact_file(
            target_directory_descriptor,
            target_name,
            target,
            (10001, 10001, 0o400, 1),
            source_content,
        )
        os.close(final_descriptor)
        require_source_unchanged(
            source_descriptor,
            source_directory_descriptor,
            source_name,
            source,
            expected_identity,
            source_content,
        )
        require_source_unchanged(
            claim_descriptor,
            source_directory_descriptor,
            claim_name,
            claim_source,
            expected_claim_identity,
            claim_content,
        )
        if optional_named_file(
            target_directory_descriptor,
            CANDIDATE_NAME,
            candidate_path,
        ) is not None:
            reject()
        os.fsync(target_directory_descriptor)
        os.fsync(source_directory_descriptor)
    finally:
        if target_descriptor is not None:
            os.close(target_descriptor)
        if candidate_descriptor is not None:
            os.close(candidate_descriptor)
        if source_descriptor is not None:
            os.close(source_descriptor)
        if claim_descriptor is not None:
            os.close(claim_descriptor)
        os.close(target_directory_descriptor)
        os.close(source_directory_descriptor)


try:
    if len(sys.argv) != 7:
        reject()
    claim_id, digest = read_private_metadata(sys.argv[6])
    prepare(
        sys.argv[1],
        sys.argv[2],
        sys.argv[3],
        sys.argv[4],
        sys.argv[5],
        claim_id,
        digest,
    )
except Exception:
    raise SystemExit(1)
PY
  then
    python_status=0
  else
    python_status=$?
  fi
  exec {metadata_fd}<&- ||
    die 'the private retryable KemerBet cohort metadata channel could not be closed'
  [[ "$python_status" -eq 0 ]] ||
    die 'the retryable KemerBet session Player-ID copy could not be prepared safely'

  inspect_owner_staged_kemerbet_cohort
  after_player_dev_ino="$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO"
  after_claim_dev_ino="$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO"
  after_claim_id="$KEMERBET_RECHECK_OWNER_CLAIM_ID"
  after_digest="$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"
  [[ "$after_player_dev_ino" == "$before_player_dev_ino" &&
    "$after_claim_dev_ino" == "$before_claim_dev_ino" &&
    "$after_claim_id" == "$before_claim_id" && "$after_digest" == "$before_digest" ]] ||
    die 'the retryable KemerBet Owner cohort changed while preparing private sign-in'
  owner_kemerbet_cohort_marker require-failed "$before_claim_id" ||
    die 'the retryable KemerBet cohort failure marker changed during private sign-in preparation'
  if [[ "$migration_awaiting" == 'true' ]]; then
    require_kemerbet_v1_retired_awaiting_v2 "$commit_sha" ||
      die 'the explicit v1 retirement state changed during private sign-in preparation'
  fi
  require_service_file "$KEMERBET_READINESS_PLAYER_IDS"
  [[ "$(stat --format='%h' "$KEMERBET_READINESS_PLAYER_IDS")" == '1' &&
    "$(sha256sum -- "$KEMERBET_READINESS_PLAYER_IDS" | awk '{print $1}')" == "$before_digest" ]] ||
    die 'the retryable KemerBet session Player-ID copy is not exact'
}

promote_owner_staged_kemerbet_player_ids() {
  local claim_source control_mountpoint digest_fd python_status source
  command -v python3 >/dev/null 2>&1 ||
    die 'the fixed Owner-staged KemerBet cohort verifier is unavailable'
  control_mountpoint="$(resolve_kemerbet_session_control_volume_mountpoint)"
  source="$control_mountpoint/$KEMERBET_OWNER_STAGED_PLAYER_IDS_NAME"
  claim_source="$control_mountpoint/$KEMERBET_OWNER_STAGED_CLAIM_NAME"

  exec {digest_fd}<<<"$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" ||
    die 'the private Owner-staged KemerBet digest channel could not be opened'
  if env -i PATH="$SAFE_PATH" python3 -I - \
    "$source" "$claim_source" "$KEMERBET_READINESS_PLAYER_IDS" \
    "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" \
    "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" \
    "$KEMERBET_RECHECK_OWNER_CLAIM_ID" \
    "$digest_fd" <<'PY'
import hashlib
import os
import re
import stat
import sys

EXPECTED_SOURCE_NAME = 'kemerbet-readiness-player-ids.stage-v1'
EXPECTED_CLAIM_NAME = 'kemerbet-readiness-cohort-claim.stage-v1'
EXPECTED_TARGET = '/etc/fetanagent/executor-secrets/kemerbet_no_transfer_readiness_player_ids'
PLAYER_ID = re.compile(rb'[A-Za-z0-9][A-Za-z0-9._-]{0,63}')
CLAIM_ID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}')
DEV_INO = re.compile(r'([0-9]+):([0-9]+)')
DIGEST = re.compile(r'[0-9a-f]{64}')
MAXIMUM_BYTES = 1024


def reject():
    raise RuntimeError()


def read_private_digest(descriptor_text):
    if not descriptor_text.isascii() or not descriptor_text.isdecimal():
        reject()
    descriptor = int(descriptor_text, 10)
    if descriptor < 3 or descriptor > 1024:
        reject()
    try:
        content = os.read(descriptor, 66)
    finally:
        os.close(descriptor)
    if len(content) != 65 or not content.endswith(b'\n'):
        reject()
    try:
        value = content[:-1].decode('ascii')
    except UnicodeDecodeError:
        reject()
    if DIGEST.fullmatch(value) is None:
        reject()
    return value


def exact_mode(value):
    return stat.S_IMODE(value.st_mode)


def require_exact_directory(path, descriptor, expected_uid, expected_gid, expected_mode):
    opened = os.fstat(descriptor)
    named = os.lstat(path)
    if (
        not stat.S_ISDIR(opened.st_mode)
        or not stat.S_ISDIR(named.st_mode)
        or (opened.st_dev, opened.st_ino) != (named.st_dev, named.st_ino)
        or opened.st_uid != expected_uid
        or opened.st_gid != expected_gid
        or exact_mode(opened) != expected_mode
        or named.st_uid != opened.st_uid
        or named.st_gid != opened.st_gid
        or named.st_mode != opened.st_mode
        or os.path.realpath(path) != path
    ):
        reject()


def open_exact_directory(path, expected_uid, expected_gid, expected_mode):
    descriptor = os.open(
        path,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
    )
    try:
        require_exact_directory(path, descriptor, expected_uid, expected_gid, expected_mode)
    except Exception:
        os.close(descriptor)
        raise
    return descriptor


def optional_named_file(directory_descriptor, name, absolute_path):
    try:
        relative_value = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
    except FileNotFoundError:
        try:
            os.lstat(absolute_path)
        except FileNotFoundError:
            return None
        reject()
    try:
        absolute_value = os.lstat(absolute_path)
    except FileNotFoundError:
        reject()
    if (
        (relative_value.st_dev, relative_value.st_ino)
        != (absolute_value.st_dev, absolute_value.st_ino)
        or relative_value.st_mode != absolute_value.st_mode
        or relative_value.st_uid != absolute_value.st_uid
        or relative_value.st_gid != absolute_value.st_gid
        or relative_value.st_nlink != absolute_value.st_nlink
        or relative_value.st_size != absolute_value.st_size
    ):
        reject()
    return relative_value


def require_absent(directory_descriptor, name, absolute_path):
    if optional_named_file(directory_descriptor, name, absolute_path) is not None:
        reject()


def require_open_file(
    descriptor,
    expected_uid,
    expected_gid,
    expected_mode,
    expected_size,
    expected_links=1,
):
    value = os.fstat(descriptor)
    if (
        not stat.S_ISREG(value.st_mode)
        or value.st_uid != expected_uid
        or value.st_gid != expected_gid
        or exact_mode(value) != expected_mode
        or value.st_nlink != expected_links
        or value.st_size != expected_size
    ):
        reject()
    return value


def require_named_identity(
    directory_descriptor,
    name,
    absolute_path,
    identity,
    expected_uid,
    expected_gid,
    expected_mode,
    expected_size,
    expected_links=1,
):
    value = optional_named_file(directory_descriptor, name, absolute_path)
    if (
        value is None
        or not stat.S_ISREG(value.st_mode)
        or (value.st_dev, value.st_ino) != identity
        or value.st_uid != expected_uid
        or value.st_gid != expected_gid
        or exact_mode(value) != expected_mode
        or value.st_nlink != expected_links
        or value.st_size != expected_size
    ):
        reject()
    return value


def read_exact(descriptor, expected_size, maximum_size):
    if expected_size < 1 or expected_size > maximum_size:
        reject()
    content = os.pread(descriptor, maximum_size + 1, 0)
    if len(content) != expected_size:
        reject()
    return content


def validate_player_content(content):
    if len(content) < 10 or len(content) > MAXIMUM_BYTES:
        reject()
    if not content.endswith(b'\n') or b'\r' in content or b'\0' in content:
        reject()
    lines = content[:-1].split(b'\n')
    if len(lines) != 5 or len(set(lines)) != 5:
        reject()
    if any(PLAYER_ID.fullmatch(line) is None for line in lines):
        reject()


def require_content_digest(content, expected_digest):
    if DIGEST.fullmatch(expected_digest) is None:
        reject()
    if hashlib.sha256(content).hexdigest() != expected_digest:
        reject()


def parse_identity(value):
    match = DEV_INO.fullmatch(value)
    if match is None:
        reject()
    return int(match.group(1)), int(match.group(2))


def open_stage_file(
    directory_descriptor,
    name,
    path,
    expected_identity,
    expected_content,
    player_file,
):
    named = optional_named_file(directory_descriptor, name, path)
    if (
        named is None
        or not stat.S_ISREG(named.st_mode)
        or (named.st_dev, named.st_ino) != expected_identity
        or named.st_nlink != 1
        or (named.st_uid, named.st_gid, exact_mode(named))
        not in {
            (10001, 10001, 0o400),
            (10001, 10001, 0o444),
            (0, 0, 0o400),
            (0, 0, 0o444),
        }
    ):
        reject()
    if player_file:
        if named.st_size < 10 or named.st_size > MAXIMUM_BYTES:
            reject()
    elif named.st_size != len(expected_content):
        reject()
    descriptor = os.open(
        name,
        os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=directory_descriptor,
    )
    try:
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or (opened.st_dev, opened.st_ino) != expected_identity
            or opened.st_mode != named.st_mode
            or opened.st_uid != named.st_uid
            or opened.st_gid != named.st_gid
            or opened.st_nlink != 1
            or opened.st_size != named.st_size
        ):
            reject()
        content = read_exact(
            descriptor,
            opened.st_size,
            MAXIMUM_BYTES if player_file else len(expected_content),
        )
        if player_file:
            validate_player_content(content)
        elif content != expected_content:
            reject()
        return descriptor, content
    except Exception:
        os.close(descriptor)
        raise


def freeze_stage_file(
    directory_descriptor,
    name,
    path,
    descriptor,
    identity,
    content,
):
    opened = os.fstat(descriptor)
    if (opened.st_dev, opened.st_ino) != identity or opened.st_nlink != 1:
        reject()
    metadata = (opened.st_uid, opened.st_gid, exact_mode(opened))
    if metadata in {
        (10001, 10001, 0o400),
        (10001, 10001, 0o444),
    }:
        os.fchown(descriptor, 0, 0)
    elif metadata not in {(0, 0, 0o400), (0, 0, 0o444)}:
        reject()
    if exact_mode(os.fstat(descriptor)) != 0o444:
        os.fchmod(descriptor, 0o444)
    os.fsync(descriptor)
    require_open_file(descriptor, 0, 0, 0o444, len(content))
    require_named_identity(
        directory_descriptor,
        name,
        path,
        identity,
        0,
        0,
        0o444,
        len(content),
    )
    if read_exact(descriptor, len(content), MAXIMUM_BYTES) != content:
        reject()


def write_all(descriptor, content):
    offset = 0
    while offset < len(content):
        written = os.write(descriptor, content[offset:])
        if written < 1:
            reject()
        offset += written


def open_exact_target(
    target_directory_descriptor,
    target_name,
    target,
    expected_links=1,
):
    descriptor = os.open(
        target_name,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=target_directory_descriptor,
    )
    try:
        opened = os.fstat(descriptor)
        if opened.st_size < 10 or opened.st_size > MAXIMUM_BYTES:
            reject()
        require_open_file(
            descriptor,
            10001,
            10001,
            0o400,
            opened.st_size,
            expected_links,
        )
        require_named_identity(
            target_directory_descriptor,
            target_name,
            target,
            (opened.st_dev, opened.st_ino),
            10001,
            10001,
            0o400,
            opened.st_size,
            expected_links,
        )
        content = read_exact(descriptor, opened.st_size, MAXIMUM_BYTES)
        validate_player_content(content)
        return descriptor, (opened.st_dev, opened.st_ino), content
    except Exception:
        os.close(descriptor)
        raise


def fsync_directory(descriptor):
    os.fsync(descriptor)


def recover_candidate(
    target_directory_descriptor,
    target_name,
    target,
    candidate_name,
    candidate_path,
    expected_player_digest,
):
    candidate = optional_named_file(
        target_directory_descriptor,
        candidate_name,
        candidate_path,
    )
    if candidate is None:
        return
    if not stat.S_ISREG(candidate.st_mode) or candidate.st_size > MAXIMUM_BYTES:
        reject()
    target_value = optional_named_file(target_directory_descriptor, target_name, target)
    if target_value is None:
        if (
            candidate.st_nlink != 1
            or (candidate.st_uid, candidate.st_gid, exact_mode(candidate))
            not in {
                (0, 0, 0o600),
                (10001, 10001, 0o600),
                (10001, 10001, 0o400),
            }
        ):
            reject()
        descriptor = os.open(
            candidate_name,
            os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
            dir_fd=target_directory_descriptor,
        )
        try:
            opened = os.fstat(descriptor)
            if (
                not stat.S_ISREG(opened.st_mode)
                or (opened.st_dev, opened.st_ino) != (candidate.st_dev, candidate.st_ino)
                or opened.st_mode != candidate.st_mode
                or opened.st_uid != candidate.st_uid
                or opened.st_gid != candidate.st_gid
                or opened.st_nlink != 1
                or opened.st_size != candidate.st_size
            ):
                reject()
            if (
                (opened.st_uid, opened.st_gid, exact_mode(opened))
                == (10001, 10001, 0o400)
            ):
                completed_content = read_exact(descriptor, opened.st_size, MAXIMUM_BYTES)
                validate_player_content(completed_content)
                require_content_digest(completed_content, expected_player_digest)
        finally:
            os.close(descriptor)
        os.unlink(candidate_name, dir_fd=target_directory_descriptor)
        fsync_directory(target_directory_descriptor)
        require_absent(target_directory_descriptor, candidate_name, candidate_path)
        return

    if (
        not stat.S_ISREG(target_value.st_mode)
        or (candidate.st_dev, candidate.st_ino) != (target_value.st_dev, target_value.st_ino)
        or candidate.st_nlink != 2
        or target_value.st_nlink != 2
        or (candidate.st_uid, candidate.st_gid, exact_mode(candidate))
        != (10001, 10001, 0o400)
        or candidate.st_size < 10
    ):
        reject()
    candidate_descriptor, candidate_identity, candidate_content = open_exact_target(
        target_directory_descriptor,
        candidate_name,
        candidate_path,
        2,
    )
    target_descriptor, target_identity, target_content = open_exact_target(
        target_directory_descriptor,
        target_name,
        target,
        2,
    )
    try:
        if candidate_identity != target_identity or candidate_content != target_content:
            reject()
        require_content_digest(candidate_content, expected_player_digest)
        require_content_digest(target_content, expected_player_digest)
    finally:
        os.close(target_descriptor)
        os.close(candidate_descriptor)
    os.unlink(candidate_name, dir_fd=target_directory_descriptor)
    fsync_directory(target_directory_descriptor)
    require_absent(target_directory_descriptor, candidate_name, candidate_path)


def promote(
    source,
    claim_source,
    target,
    expected_player_identity,
    expected_claim_identity,
    claim_id,
    expected_player_digest,
):
    if (
        os.path.basename(source) != EXPECTED_SOURCE_NAME
        or os.path.basename(claim_source) != EXPECTED_CLAIM_NAME
        or os.path.dirname(source) != os.path.dirname(claim_source)
        or target != EXPECTED_TARGET
        or os.path.basename(target)
        != 'kemerbet_no_transfer_readiness_player_ids'
        or CLAIM_ID.fullmatch(claim_id) is None
        or DIGEST.fullmatch(expected_player_digest) is None
    ):
        reject()
    player_identity = parse_identity(expected_player_identity)
    claim_identity = parse_identity(expected_claim_identity)
    source_parent = os.path.dirname(source)
    target_parent = os.path.dirname(target)
    source_name = os.path.basename(source)
    claim_name = os.path.basename(claim_source)
    target_name = os.path.basename(target)
    candidate_name = '.kemerbet-readiness-player-ids.promote-v1'
    candidate_path = os.path.join(target_parent, candidate_name)
    source_directory_descriptor = open_exact_directory(source_parent, 10001, 10001, 0o700)
    target_directory_descriptor = open_exact_directory(target_parent, 0, 0, 0o700)
    player_descriptor = None
    claim_descriptor = None
    candidate_descriptor = None
    target_descriptor = None
    try:
        for forbidden_name in (
            '.kemerbet-readiness-player-ids.stage-v1.installing',
            '.kemerbet-readiness-cohort-claim.stage-v1.installing',
            '.kemerbet-readiness-cohort-imported-v1.installing',
            'kemerbet-readiness-cohort-imported-v1',
            '.kemerbet-readiness-cohort-completed-v1.installing',
            'kemerbet-readiness-cohort-completed-v1',
            '.kemerbet-readiness-cohort-failed-v1.installing',
            'kemerbet-readiness-cohort-failed-v1',
        ):
            require_absent(
                source_directory_descriptor,
                forbidden_name,
                os.path.join(source_parent, forbidden_name),
            )
        player_descriptor, player_content = open_stage_file(
            source_directory_descriptor,
            source_name,
            source,
            player_identity,
            b'',
            True,
        )
        require_content_digest(player_content, expected_player_digest)
        claim_content = (claim_id + '\n').encode('ascii')
        claim_descriptor, actual_claim_content = open_stage_file(
            source_directory_descriptor,
            claim_name,
            claim_source,
            claim_identity,
            claim_content,
            False,
        )
        if actual_claim_content != claim_content:
            reject()
        freeze_stage_file(
            source_directory_descriptor,
            source_name,
            source,
            player_descriptor,
            player_identity,
            player_content,
        )
        require_content_digest(
            read_exact(player_descriptor, len(player_content), MAXIMUM_BYTES),
            expected_player_digest,
        )
        freeze_stage_file(
            source_directory_descriptor,
            claim_name,
            claim_source,
            claim_descriptor,
            claim_identity,
            claim_content,
        )
        fsync_directory(source_directory_descriptor)

        recover_candidate(
            target_directory_descriptor,
            target_name,
            target,
            candidate_name,
            candidate_path,
            expected_player_digest,
        )
        target_present = optional_named_file(
            target_directory_descriptor,
            target_name,
            target,
        )
        if target_present is not None:
            target_descriptor, target_identity, target_content = open_exact_target(
                target_directory_descriptor,
                target_name,
                target,
            )
            if target_content != player_content:
                reject()
            require_content_digest(target_content, expected_player_digest)
        else:
            candidate_descriptor = os.open(
                candidate_name,
                os.O_RDWR
                | os.O_CREAT
                | os.O_EXCL
                | os.O_NOFOLLOW
                | os.O_CLOEXEC,
                0o600,
                dir_fd=target_directory_descriptor,
            )
            os.ftruncate(candidate_descriptor, 0)
            write_all(candidate_descriptor, player_content)
            os.fchown(candidate_descriptor, 10001, 10001)
            os.fchmod(candidate_descriptor, 0o400)
            os.fsync(candidate_descriptor)
            candidate = require_open_file(
                candidate_descriptor,
                10001,
                10001,
                0o400,
                len(player_content),
            )
            candidate_identity = (candidate.st_dev, candidate.st_ino)
            if read_exact(candidate_descriptor, len(player_content), MAXIMUM_BYTES) != player_content:
                reject()
            require_named_identity(
                target_directory_descriptor,
                candidate_name,
                candidate_path,
                candidate_identity,
                10001,
                10001,
                0o400,
                len(player_content),
            )
            fsync_directory(target_directory_descriptor)
            require_named_identity(
                source_directory_descriptor,
                source_name,
                source,
                player_identity,
                0,
                0,
                0o444,
                len(player_content),
            )
            if read_exact(player_descriptor, len(player_content), MAXIMUM_BYTES) != player_content:
                reject()
            require_absent(target_directory_descriptor, target_name, target)
            os.link(
                candidate_name,
                target_name,
                src_dir_fd=target_directory_descriptor,
                dst_dir_fd=target_directory_descriptor,
                follow_symlinks=False,
            )
            fsync_directory(target_directory_descriptor)
            require_open_file(
                candidate_descriptor,
                10001,
                10001,
                0o400,
                len(player_content),
                2,
            )
            require_named_identity(
                target_directory_descriptor,
                candidate_name,
                candidate_path,
                candidate_identity,
                10001,
                10001,
                0o400,
                len(player_content),
                2,
            )
            require_named_identity(
                target_directory_descriptor,
                target_name,
                target,
                candidate_identity,
                10001,
                10001,
                0o400,
                len(player_content),
                2,
            )
            os.unlink(candidate_name, dir_fd=target_directory_descriptor)
            fsync_directory(target_directory_descriptor)
            require_absent(target_directory_descriptor, candidate_name, candidate_path)
            require_open_file(
                candidate_descriptor,
                10001,
                10001,
                0o400,
                len(player_content),
            )
            target_descriptor, target_identity, target_content = open_exact_target(
                target_directory_descriptor,
                target_name,
                target,
            )
            if target_identity != candidate_identity or target_content != player_content:
                reject()
            require_content_digest(target_content, expected_player_digest)

        require_absent(target_directory_descriptor, candidate_name, candidate_path)
        require_named_identity(
            source_directory_descriptor,
            source_name,
            source,
            player_identity,
            0,
            0,
            0o444,
            len(player_content),
        )
        require_named_identity(
            source_directory_descriptor,
            claim_name,
            claim_source,
            claim_identity,
            0,
            0,
            0o444,
            len(claim_content),
        )
        if (
            read_exact(player_descriptor, len(player_content), MAXIMUM_BYTES) != player_content
            or read_exact(claim_descriptor, len(claim_content), len(claim_content))
            != claim_content
        ):
            reject()
        os.fsync(target_descriptor)
        fsync_directory(target_directory_descriptor)
        fsync_directory(source_directory_descriptor)
        require_exact_directory(
            source_parent,
            source_directory_descriptor,
            10001,
            10001,
            0o700,
        )
        require_exact_directory(
            target_parent,
            target_directory_descriptor,
            0,
            0,
            0o700,
        )
        require_absent(target_directory_descriptor, candidate_name, candidate_path)
        require_named_identity(
            target_directory_descriptor,
            target_name,
            target,
            target_identity,
            10001,
            10001,
            0o400,
            len(target_content),
        )
        if read_exact(target_descriptor, len(target_content), MAXIMUM_BYTES) != target_content:
            reject()
        require_content_digest(target_content, expected_player_digest)
    finally:
        if target_descriptor is not None:
            os.close(target_descriptor)
        if candidate_descriptor is not None:
            os.close(candidate_descriptor)
        if claim_descriptor is not None:
            os.close(claim_descriptor)
        if player_descriptor is not None:
            os.close(player_descriptor)
        os.close(target_directory_descriptor)
        os.close(source_directory_descriptor)


try:
    if len(sys.argv) != 8:
        reject()
    promote(
        sys.argv[1],
        sys.argv[2],
        sys.argv[3],
        sys.argv[4],
        sys.argv[5],
        sys.argv[6],
        read_private_digest(sys.argv[7]),
    )
except Exception:
    raise SystemExit(1)
PY
  then
    python_status=0
  else
    python_status=$?
  fi
  exec {digest_fd}<&- ||
    die 'the private Owner-staged KemerBet digest channel could not be closed'
  [[ "$python_status" -eq 0 ]] ||
    die 'the fixed Owner-staged KemerBet cohort could not be promoted safely'

  control_mountpoint="$(resolve_kemerbet_session_control_volume_mountpoint)"
  source="$control_mountpoint/$KEMERBET_OWNER_STAGED_PLAYER_IDS_NAME"
  claim_source="$control_mountpoint/$KEMERBET_OWNER_STAGED_CLAIM_NAME"
  [[ ! -L "$source" && -f "$source" && "$(realpath -- "$source")" == "$source" &&
    "$(stat --format='%d:%i:%u:%g:%a:%h' "$source")" == \
    "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO:0:0:444:1" &&
    "$(sha256sum -- "$source" | awk '{print $1}')" == "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" &&
    ! -L "$claim_source" && -f "$claim_source" && "$(realpath -- "$claim_source")" == "$claim_source" &&
    "$(stat --format='%d:%i:%u:%g:%a:%h:%s' "$claim_source")" == \
    "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO:0:0:444:1:37" ]] ||
    die 'the imported Owner-staged KemerBet cohort sources are unsafe'
  cmp -s -- "$claim_source" <(printf '%s\n' "$KEMERBET_RECHECK_OWNER_CLAIM_ID") ||
    die 'the imported Owner-staged KemerBet claim changed'
  require_service_file "$KEMERBET_READINESS_PLAYER_IDS"
  [[ "$(stat --format='%h' "$KEMERBET_READINESS_PLAYER_IDS")" == '1' ]] ||
    die 'the promoted one-use KemerBet Player-ID file has an unsafe hard-link count'
  [[ "$(sha256sum -- "$KEMERBET_READINESS_PLAYER_IDS" | awk '{print $1}')" == \
    "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" ]] ||
    die 'the promoted one-use KemerBet Player-ID digest changed'
}

restore_owner_staged_kemerbet_cohort() {
  local claim_source control_mountpoint digest_fd python_status source
  [[ "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" =~ ^[0-9]+:[0-9]+$ &&
    "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" =~ ^[0-9]+:[0-9]+$ &&
    "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" =~ ^[0-9a-f]{64}$ &&
    "$KEMERBET_RECHECK_OWNER_CLAIM_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] || return 1
  control_mountpoint="$(resolve_kemerbet_session_control_volume_mountpoint)" || return 1
  source="$control_mountpoint/$KEMERBET_OWNER_STAGED_PLAYER_IDS_NAME"
  claim_source="$control_mountpoint/$KEMERBET_OWNER_STAGED_CLAIM_NAME"
  exec {digest_fd}<<<"$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" || return 1
  if env -i PATH="$SAFE_PATH" python3 -I - \
    "$source" "$claim_source" \
    "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" \
    "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" \
    "$KEMERBET_RECHECK_OWNER_CLAIM_ID" \
    "$digest_fd" <<'PY'
import hashlib
import os
import re
import stat
import sys

PLAYER_ID = re.compile(rb'[A-Za-z0-9][A-Za-z0-9._-]{0,63}')
CLAIM_ID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}')
DEV_INO = re.compile(r'([0-9]+):([0-9]+)')
DIGEST = re.compile(r'[0-9a-f]{64}')
MAXIMUM_BYTES = 1024


def reject():
    raise RuntimeError()


def read_private_digest(descriptor_text):
    if not descriptor_text.isascii() or not descriptor_text.isdecimal():
        reject()
    descriptor = int(descriptor_text, 10)
    if descriptor < 3 or descriptor > 1024:
        reject()
    try:
        content = os.read(descriptor, 66)
    finally:
        os.close(descriptor)
    if len(content) != 65 or not content.endswith(b'\n'):
        reject()
    try:
        value = content[:-1].decode('ascii')
    except UnicodeDecodeError:
        reject()
    if DIGEST.fullmatch(value) is None:
        reject()
    return value


def identity(value):
    match = DEV_INO.fullmatch(value)
    if match is None:
        reject()
    return int(match.group(1)), int(match.group(2))


def exact_mode(value):
    return stat.S_IMODE(value.st_mode)


def require_directory(path, descriptor):
    opened = os.fstat(descriptor)
    named = os.lstat(path)
    if (
        not stat.S_ISDIR(opened.st_mode)
        or not stat.S_ISDIR(named.st_mode)
        or (opened.st_dev, opened.st_ino) != (named.st_dev, named.st_ino)
        or (opened.st_uid, opened.st_gid, exact_mode(opened)) != (10001, 10001, 0o700)
        or named.st_mode != opened.st_mode
        or named.st_uid != opened.st_uid
        or named.st_gid != opened.st_gid
        or os.path.realpath(path) != path
    ):
        reject()


def require_absent(directory, directory_descriptor, name):
    try:
        os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
    except FileNotFoundError:
        try:
            os.lstat(os.path.join(directory, name))
        except FileNotFoundError:
            return
    reject()


def open_source(directory, directory_descriptor, path, expected_identity, expected_content, player):
    name = os.path.basename(path)
    relative = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
    absolute = os.lstat(path)
    if (
        not stat.S_ISREG(relative.st_mode)
        or (relative.st_dev, relative.st_ino) != expected_identity
        or (absolute.st_dev, absolute.st_ino) != expected_identity
        or relative.st_mode != absolute.st_mode
        or relative.st_uid != absolute.st_uid
        or relative.st_gid != absolute.st_gid
        or relative.st_nlink != 1
        or absolute.st_nlink != 1
        or relative.st_size != absolute.st_size
        or (relative.st_uid, relative.st_gid, exact_mode(relative))
        not in {
            (10001, 10001, 0o400),
            (10001, 10001, 0o444),
            (0, 0, 0o400),
            (0, 0, 0o444),
        }
    ):
        reject()
    descriptor = os.open(
        name,
        os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=directory_descriptor,
    )
    opened = os.fstat(descriptor)
    if (
        not stat.S_ISREG(opened.st_mode)
        or (opened.st_dev, opened.st_ino) != expected_identity
        or opened.st_mode != relative.st_mode
        or opened.st_uid != relative.st_uid
        or opened.st_gid != relative.st_gid
        or opened.st_nlink != 1
        or opened.st_size != relative.st_size
    ):
        os.close(descriptor)
        reject()
    content = os.pread(descriptor, MAXIMUM_BYTES + 1, 0)
    if len(content) != opened.st_size:
        os.close(descriptor)
        reject()
    if player:
        lines = content[:-1].split(b'\n') if content.endswith(b'\n') else []
        if (
            len(content) < 10
            or len(content) > MAXIMUM_BYTES
            or b'\r' in content
            or b'\0' in content
            or len(lines) != 5
            or len(set(lines)) != 5
            or any(PLAYER_ID.fullmatch(line) is None for line in lines)
        ):
            os.close(descriptor)
            reject()
    elif content != expected_content:
        os.close(descriptor)
        reject()
    return descriptor, content


def restore(player_path, claim_path, player_identity, claim_identity, claim_id, player_digest):
    if (
        os.path.basename(player_path) != 'kemerbet-readiness-player-ids.stage-v1'
        or os.path.basename(claim_path) != 'kemerbet-readiness-cohort-claim.stage-v1'
        or os.path.dirname(player_path) != os.path.dirname(claim_path)
        or CLAIM_ID.fullmatch(claim_id) is None
        or DIGEST.fullmatch(player_digest) is None
    ):
        reject()
    directory = os.path.dirname(player_path)
    directory_descriptor = os.open(
        directory,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
    )
    player_descriptor = None
    claim_descriptor = None
    try:
        require_directory(directory, directory_descriptor)
        # Imported/failed marker installers are journal-owned crash prefixes. The immediately
        # following remove/publish transition validates and normalizes them by exact UUID; only a
        # completed transition is incompatible with restoring a retryable pair.
        for forbidden_name in (
            '.kemerbet-readiness-player-ids.stage-v1.installing',
            '.kemerbet-readiness-cohort-claim.stage-v1.installing',
            '.kemerbet-readiness-cohort-completed-v1.installing',
            'kemerbet-readiness-cohort-completed-v1',
        ):
            require_absent(directory, directory_descriptor, forbidden_name)
        claim_content = (claim_id + '\n').encode('ascii')
        player_descriptor, player_content = open_source(
            directory,
            directory_descriptor,
            player_path,
            identity(player_identity),
            b'',
            True,
        )
        if hashlib.sha256(player_content).hexdigest() != player_digest:
            reject()
        claim_descriptor, actual_claim_content = open_source(
            directory,
            directory_descriptor,
            claim_path,
            identity(claim_identity),
            claim_content,
            False,
        )
        if actual_claim_content != claim_content:
            reject()
        for descriptor, content in (
            (player_descriptor, player_content),
            (claim_descriptor, claim_content),
        ):
            os.fchown(descriptor, 10001, 10001)
            os.fchmod(descriptor, 0o400)
            os.fsync(descriptor)
            opened = os.fstat(descriptor)
            if (
                not stat.S_ISREG(opened.st_mode)
                or (opened.st_uid, opened.st_gid, exact_mode(opened), opened.st_nlink, opened.st_size)
                != (10001, 10001, 0o400, 1, len(content))
                or os.pread(descriptor, MAXIMUM_BYTES + 1, 0) != content
            ):
                reject()
        os.fsync(directory_descriptor)
        require_directory(directory, directory_descriptor)
        # Preserve the same recovery allowance after both restored inodes are durably synchronized.
        for forbidden_name in (
            '.kemerbet-readiness-player-ids.stage-v1.installing',
            '.kemerbet-readiness-cohort-claim.stage-v1.installing',
            '.kemerbet-readiness-cohort-completed-v1.installing',
            'kemerbet-readiness-cohort-completed-v1',
        ):
            require_absent(directory, directory_descriptor, forbidden_name)
        for path, expected_identity, expected_size in (
            (player_path, identity(player_identity), len(player_content)),
            (claim_path, identity(claim_identity), len(claim_content)),
        ):
            value = os.lstat(path)
            if (
                not stat.S_ISREG(value.st_mode)
                or (value.st_dev, value.st_ino) != expected_identity
                or (value.st_uid, value.st_gid, exact_mode(value), value.st_nlink, value.st_size)
                != (10001, 10001, 0o400, 1, expected_size)
            ):
                reject()
        if hashlib.sha256(
            os.pread(player_descriptor, len(player_content) + 1, 0)
        ).hexdigest() != player_digest:
            reject()
    finally:
        if claim_descriptor is not None:
            os.close(claim_descriptor)
        if player_descriptor is not None:
            os.close(player_descriptor)
        os.close(directory_descriptor)


try:
    if len(sys.argv) != 7:
        reject()
    restore(
        sys.argv[1],
        sys.argv[2],
        sys.argv[3],
        sys.argv[4],
        sys.argv[5],
        read_private_digest(sys.argv[6]),
    )
except Exception:
    raise SystemExit(1)
PY
  then
    python_status=0
  else
    python_status=$?
  fi
  exec {digest_fd}<&- || return 1
  return "$python_status"
}

consume_owner_staged_kemerbet_cohort() {
  local claim_source control_mountpoint digest_fd python_status source
  [[ "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" =~ ^[0-9]+:[0-9]+$ &&
    "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" =~ ^[0-9]+:[0-9]+$ &&
    "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" =~ ^[0-9a-f]{64}$ ]] || return 1
  control_mountpoint="$(resolve_kemerbet_session_control_volume_mountpoint)" || return 1
  source="$control_mountpoint/$KEMERBET_OWNER_STAGED_PLAYER_IDS_NAME"
  claim_source="$control_mountpoint/$KEMERBET_OWNER_STAGED_CLAIM_NAME"
  exec {digest_fd}<<<"$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" || return 1
  if env -i PATH="$SAFE_PATH" python3 -I - \
    "$source" "$claim_source" \
    "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" \
    "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" \
    "$digest_fd" <<'PY'
import hashlib
import os
import re
import stat
import sys

DEV_INO = re.compile(r'([0-9]+):([0-9]+)')
DIGEST = re.compile(r'[0-9a-f]{64}')


def reject():
    raise RuntimeError()


def read_private_digest(descriptor_text):
    if not descriptor_text.isascii() or not descriptor_text.isdecimal():
        reject()
    descriptor = int(descriptor_text, 10)
    if descriptor < 3 or descriptor > 1024:
        reject()
    try:
        content = os.read(descriptor, 66)
    finally:
        os.close(descriptor)
    if len(content) != 65 or not content.endswith(b'\n'):
        reject()
    try:
        value = content[:-1].decode('ascii')
    except UnicodeDecodeError:
        reject()
    if DIGEST.fullmatch(value) is None:
        reject()
    return value


def identity(value):
    match = DEV_INO.fullmatch(value)
    if match is None:
        reject()
    return int(match.group(1)), int(match.group(2))


def mode(value):
    return stat.S_IMODE(value.st_mode)


def require_directory(path, descriptor):
    opened = os.fstat(descriptor)
    named = os.lstat(path)
    if (
        not stat.S_ISDIR(opened.st_mode)
        or not stat.S_ISDIR(named.st_mode)
        or (opened.st_dev, opened.st_ino) != (named.st_dev, named.st_ino)
        or (opened.st_uid, opened.st_gid, mode(opened)) != (10001, 10001, 0o700)
        or opened.st_mode != named.st_mode
        or opened.st_uid != named.st_uid
        or opened.st_gid != named.st_gid
        or os.path.realpath(path) != path
    ):
        reject()


def optional_file(directory, directory_descriptor, path, expected_identity, expected_size):
    name = os.path.basename(path)
    try:
        named = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
    except FileNotFoundError:
        try:
            os.lstat(path)
        except FileNotFoundError:
            return None
        reject()
    absolute = os.lstat(path)
    if (
        not stat.S_ISREG(named.st_mode)
        or (named.st_dev, named.st_ino) != expected_identity
        or (absolute.st_dev, absolute.st_ino) != expected_identity
        or named.st_mode != absolute.st_mode
        or named.st_uid != absolute.st_uid
        or named.st_gid != absolute.st_gid
        or named.st_nlink != 1
        or absolute.st_nlink != 1
        or named.st_size != expected_size
        or absolute.st_size != expected_size
        or (named.st_uid, named.st_gid, mode(named)) != (0, 0, 0o444)
    ):
        reject()
    descriptor = os.open(
        name,
        os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=directory_descriptor,
    )
    opened = os.fstat(descriptor)
    if (
        not stat.S_ISREG(opened.st_mode)
        or (opened.st_dev, opened.st_ino) != expected_identity
        or opened.st_mode != named.st_mode
        or opened.st_uid != named.st_uid
        or opened.st_gid != named.st_gid
        or opened.st_nlink != 1
        or opened.st_size != expected_size
    ):
        os.close(descriptor)
        reject()
    return name, path, descriptor, expected_identity, expected_size


def require_named(directory_descriptor, item):
    name, path, descriptor, expected_identity, expected_size = item
    named = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
    absolute = os.lstat(path)
    opened = os.fstat(descriptor)
    for value in (named, absolute, opened):
        if (
            not stat.S_ISREG(value.st_mode)
            or (value.st_dev, value.st_ino) != expected_identity
            or (value.st_uid, value.st_gid, mode(value), value.st_nlink, value.st_size)
            != (0, 0, 0o444, 1, expected_size)
        ):
            reject()


def require_absent(directory, directory_descriptor, path):
    name = os.path.basename(path)
    try:
        os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
    except FileNotFoundError:
        try:
            os.lstat(path)
        except FileNotFoundError:
            return
    reject()


def erase(descriptor, size):
    block = b'\0' * min(size, 1024)
    offset = 0
    while offset < size:
        length = min(len(block), size - offset)
        written = os.pwrite(descriptor, block[:length], offset)
        if written <= 0:
            reject()
        offset += written
    os.fsync(descriptor)


def consume(player_path, claim_path, player_identity, claim_identity, player_digest):
    if (
        os.path.basename(player_path) != 'kemerbet-readiness-player-ids.stage-v1'
        or os.path.basename(claim_path) != 'kemerbet-readiness-cohort-claim.stage-v1'
        or os.path.dirname(player_path) != os.path.dirname(claim_path)
        or player_identity == claim_identity
        or DIGEST.fullmatch(player_digest) is None
    ):
        reject()
    directory = os.path.dirname(player_path)
    directory_descriptor = os.open(
        directory,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
    )
    items = []
    try:
        require_directory(directory, directory_descriptor)
        player_size = None
        try:
            player_named = os.stat(
                os.path.basename(player_path),
                dir_fd=directory_descriptor,
                follow_symlinks=False,
            )
            player_size = player_named.st_size
        except FileNotFoundError:
            try:
                os.lstat(player_path)
            except FileNotFoundError:
                pass
            else:
                reject()
        if player_size is not None and not 10 <= player_size <= 1024:
            reject()
        player = (
            optional_file(
                directory,
                directory_descriptor,
                player_path,
                player_identity,
                player_size,
            )
            if player_size is not None
            else None
        )
        claim = optional_file(
            directory,
            directory_descriptor,
            claim_path,
            claim_identity,
            37,
        )
        items = [item for item in (player, claim) if item is not None]
        if player is not None:
            player_content = os.pread(player[2], player[4] + 1, 0)
            if (
                len(player_content) != player[4]
                or hashlib.sha256(player_content).hexdigest() != player_digest
            ):
                reject()
        for item in items:
            require_named(directory_descriptor, item)
        for item in items:
            os.unlink(item[0], dir_fd=directory_descriptor)
        os.fsync(directory_descriptor)
        require_directory(directory, directory_descriptor)
        require_absent(directory, directory_descriptor, player_path)
        require_absent(directory, directory_descriptor, claim_path)
        # Durable namespace removal is the recovery authority. Any best-effort wipe happens only
        # through the already-unlinked descriptors, so an interrupted wipe cannot leave a named,
        # partially modified stage file that fails its journaled content digest forever.
        for item in items:
            erase(item[2], item[4])
    finally:
        for item in items:
            os.close(item[2])
        os.close(directory_descriptor)


try:
    if len(sys.argv) != 6:
        reject()
    consume(
        sys.argv[1],
        sys.argv[2],
        identity(sys.argv[3]),
        identity(sys.argv[4]),
        read_private_digest(sys.argv[5]),
    )
except Exception:
    raise SystemExit(1)
PY
  then
    python_status=0
  else
    python_status=$?
  fi
  exec {digest_fd}<&- || return 1
  [[ "$python_status" -eq 0 ]] || return 1
  [[ ! -e "$source" && ! -L "$source" && ! -e "$claim_source" && ! -L "$claim_source" ]] || return 1
  [[ ! -e "$control_mountpoint/$KEMERBET_OWNER_STAGED_PLAYER_IDS_INSTALLING_NAME" &&
    ! -L "$control_mountpoint/$KEMERBET_OWNER_STAGED_PLAYER_IDS_INSTALLING_NAME" &&
    ! -e "$control_mountpoint/$KEMERBET_OWNER_STAGED_CLAIM_INSTALLING_NAME" &&
    ! -L "$control_mountpoint/$KEMERBET_OWNER_STAGED_CLAIM_INSTALLING_NAME" ]]
}

owner_kemerbet_cohort_marker() {
  local action="$1" claim_id="$2" installing_name marker_name
  case "$action" in
    publish-imported|require-imported|remove-imported)
      marker_name="$KEMERBET_OWNER_IMPORTED_CLAIM_NAME"
      installing_name="$KEMERBET_OWNER_IMPORTED_CLAIM_INSTALLING_NAME"
      ;;
    publish-completed|require-completed|remove-completed)
      marker_name="$KEMERBET_OWNER_COMPLETED_CLAIM_NAME"
      installing_name="$KEMERBET_OWNER_COMPLETED_CLAIM_INSTALLING_NAME"
      ;;
    publish-failed|require-failed|remove-failed)
      marker_name="$KEMERBET_OWNER_FAILED_CLAIM_NAME"
      installing_name="$KEMERBET_OWNER_FAILED_CLAIM_INSTALLING_NAME"
      ;;
    guard-retry)
      marker_name="$KEMERBET_OWNER_FAILED_CLAIM_NAME"
      installing_name="$KEMERBET_OWNER_FAILED_CLAIM_INSTALLING_NAME"
      ;;
    *) return 1 ;;
  esac
  [[ "$claim_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] ||
    return 1
  [[ $# -eq 2 ]] || return 1
  require_kemerbet_recovery_latch_authority || return 1
  require_owner_kemerbet_receipt_service_access || return 1
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$action" "$KEMERBET_OWNER_RECEIPT_ROOT/$marker_name" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$installing_name" "$claim_id" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_NAME" \
    "$KEMERBET_RECOVERY_LATCH_DEV_INO" <<'PY'
import os
import re
import stat
import sys

CLAIM_ID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}')
ALLOWED = {
    'kemerbet-readiness-cohort-imported-v1': '.kemerbet-readiness-cohort-imported-v1.installing',
    'kemerbet-readiness-cohort-completed-v1': '.kemerbet-readiness-cohort-completed-v1.installing',
    'kemerbet-readiness-cohort-failed-v1': '.kemerbet-readiness-cohort-failed-v1.installing',
}
LATCH_CONTENT = b"fetanagent-kemerbet-readiness-recovery-in-progress-or-failed-v1\n"
LATCH_NAME = 'kemerbet-readiness-recovery-in-progress-or-failed-v1'


def reject():
    raise RuntimeError()


def mode(value):
    return stat.S_IMODE(value.st_mode)


def require_directory(path, descriptor):
    opened = os.fstat(descriptor)
    named = os.lstat(path)
    if (
        not stat.S_ISDIR(opened.st_mode)
        or not stat.S_ISDIR(named.st_mode)
        or (opened.st_dev, opened.st_ino) != (named.st_dev, named.st_ino)
        or (opened.st_uid, opened.st_gid, mode(opened)) != (0, 0, 0o755)
        or named.st_mode != opened.st_mode
        or named.st_uid != opened.st_uid
        or named.st_gid != opened.st_gid
        or os.path.realpath(path) != path
    ):
        reject()


def optional(directory_descriptor, name, path):
    try:
        relative = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
    except FileNotFoundError:
        try:
            os.lstat(path)
        except FileNotFoundError:
            return None
        reject()
    absolute = os.lstat(path)
    if (
        (relative.st_dev, relative.st_ino) != (absolute.st_dev, absolute.st_ino)
        or relative.st_mode != absolute.st_mode
        or relative.st_uid != absolute.st_uid
        or relative.st_gid != absolute.st_gid
        or relative.st_nlink != absolute.st_nlink
        or relative.st_size != absolute.st_size
    ):
        reject()
    return relative


def exact_marker(directory_descriptor, name, path, content, links=1):
    named = optional(directory_descriptor, name, path)
    if (
        named is None
        or not stat.S_ISREG(named.st_mode)
        or (named.st_uid, named.st_gid, mode(named), named.st_nlink, named.st_size)
        != (0, 10001, 0o440, links, len(content))
    ):
        reject()
    descriptor = os.open(
        name,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=directory_descriptor,
    )
    try:
        opened = os.fstat(descriptor)
        if (
            (opened.st_dev, opened.st_ino) != (named.st_dev, named.st_ino)
            or opened.st_mode != named.st_mode
            or opened.st_uid != named.st_uid
            or opened.st_gid != named.st_gid
            or opened.st_nlink != links
            or opened.st_size != len(content)
            or os.pread(descriptor, len(content) + 1, 0) != content
        ):
            reject()
        return opened.st_dev, opened.st_ino
    finally:
        os.close(descriptor)


def exact_installing_prefix(directory_descriptor, name, named, content):
    if (
        not stat.S_ISREG(named.st_mode)
        or named.st_nlink != 1
        or named.st_size > len(content)
        or (named.st_uid, named.st_gid, mode(named))
        not in {(0, 0, 0o600), (0, 10001, 0o600), (0, 10001, 0o440)}
    ):
        reject()
    descriptor = os.open(
        name,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=directory_descriptor,
    )
    try:
        opened = os.fstat(descriptor)
        if (
            (opened.st_dev, opened.st_ino) != (named.st_dev, named.st_ino)
            or opened.st_mode != named.st_mode
            or opened.st_uid != named.st_uid
            or opened.st_gid != named.st_gid
            or opened.st_nlink != named.st_nlink
            or opened.st_size != named.st_size
            or os.pread(descriptor, len(content) + 1, 0) != content[:named.st_size]
        ):
            reject()
    finally:
        os.close(descriptor)


def exact_recovery_latch(directory_descriptor, name, path, expected_dev_ino):
    named = optional(directory_descriptor, name, path)
    if (
        named is None
        or not stat.S_ISREG(named.st_mode)
        or (named.st_uid, named.st_gid, mode(named), named.st_nlink, named.st_size)
        != (0, 0, 0o400, 1, len(LATCH_CONTENT))
        or f"{named.st_dev}:{named.st_ino}" != expected_dev_ino
    ):
        reject()
    descriptor = os.open(
        name,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=directory_descriptor,
    )
    try:
        opened = os.fstat(descriptor)
        if (
            (opened.st_dev, opened.st_ino) != (named.st_dev, named.st_ino)
            or opened.st_mode != named.st_mode
            or opened.st_uid != named.st_uid
            or opened.st_gid != named.st_gid
            or opened.st_nlink != 1
            or opened.st_size != len(LATCH_CONTENT)
            or os.pread(descriptor, len(LATCH_CONTENT) + 1, 0) != LATCH_CONTENT
        ):
            reject()
    finally:
        os.close(descriptor)


def write_all(descriptor, content):
    offset = 0
    while offset < len(content):
        written = os.write(descriptor, content[offset:])
        if written <= 0:
            reject()
        offset += written


def transition(action, marker_path, installing_path, claim_id, latch_path, latch_dev_ino):
    marker_name = os.path.basename(marker_path)
    installing_name = os.path.basename(installing_path)
    directory = os.path.dirname(marker_path)
    if (
        action not in {
            'publish-imported', 'require-imported', 'remove-imported',
            'publish-completed', 'require-completed', 'remove-completed',
            'publish-failed', 'require-failed', 'remove-failed',
            'guard-retry',
        }
        or ALLOWED.get(marker_name) != installing_name
        or os.path.dirname(installing_path) != directory
        or os.path.dirname(latch_path) != directory
        or os.path.basename(latch_path) != LATCH_NAME
        or CLAIM_ID.fullmatch(claim_id) is None
        or (action != 'guard-retry' and action.split('-', 1)[1] not in marker_name)
    ):
        reject()
    content = (claim_id + '\n').encode('ascii')
    directory_descriptor = os.open(
        directory,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
    )
    installing_descriptor = None
    try:
        require_directory(directory, directory_descriptor)
        latch = optional(directory_descriptor, LATCH_NAME, latch_path)
        namespace = set(ALLOWED) | set(ALLOWED.values())
        if latch is None:
            if latch_dev_ino:
                reject()
        else:
            if re.fullmatch(r'[0-9]+:[0-9]+', latch_dev_ino) is None:
                reject()
            exact_recovery_latch(directory_descriptor, LATCH_NAME, latch_path, latch_dev_ino)
            namespace.add(LATCH_NAME)
        if any(entry not in namespace for entry in os.listdir(directory_descriptor)):
            reject()
        if action == 'guard-retry':
            observed = []
            for final_name, pending_name in ALLOWED.items():
                final_path = os.path.join(directory, final_name)
                pending_path = os.path.join(directory, pending_name)
                pending = optional(directory_descriptor, pending_name, pending_path)
                final = optional(directory_descriptor, final_name, final_path)
                if 'completed' in final_name and (pending is not None or final is not None):
                    reject()
                if pending is not None or final is not None:
                    observed.append((final_name, pending_name, final_path, pending_path, final, pending))
            if len(observed) > 1:
                reject()
            if observed:
                final_name, pending_name, final_path, pending_path, final, pending = observed[0]
                if pending is not None and final is not None:
                    if (
                        (pending.st_dev, pending.st_ino) != (final.st_dev, final.st_ino)
                        or pending.st_nlink != 2
                        or final.st_nlink != 2
                    ):
                        reject()
                    exact_marker(directory_descriptor, pending_name, pending_path, content, 2)
                    exact_marker(directory_descriptor, final_name, final_path, content, 2)
                elif pending is not None:
                    exact_installing_prefix(directory_descriptor, pending_name, pending, content)
                else:
                    exact_marker(directory_descriptor, final_name, final_path, content)
                if pending is not None:
                    os.unlink(pending_name, dir_fd=directory_descriptor)
                    os.fsync(directory_descriptor)
                    if optional(directory_descriptor, pending_name, pending_path) is not None:
                        reject()
                    final = optional(directory_descriptor, final_name, final_path)
                    if final is not None:
                        exact_marker(directory_descriptor, final_name, final_path, content)
            if latch is not None:
                exact_recovery_latch(
                    directory_descriptor,
                    LATCH_NAME,
                    latch_path,
                    latch_dev_ino,
                )
            if any(entry not in namespace for entry in os.listdir(directory_descriptor)):
                reject()
            require_directory(directory, directory_descriptor)
            return
        installing = optional(
            directory_descriptor,
            installing_name,
            installing_path,
        )
        marker = optional(directory_descriptor, marker_name, marker_path)
        verb = action.split('-', 1)[0]
        if installing is not None:
            if marker is not None:
                if (
                    (installing.st_dev, installing.st_ino) != (marker.st_dev, marker.st_ino)
                    or installing.st_nlink != 2
                    or marker.st_nlink != 2
                ):
                    reject()
                exact_marker(directory_descriptor, installing_name, installing_path, content, 2)
                exact_marker(directory_descriptor, marker_name, marker_path, content, 2)
                os.unlink(installing_name, dir_fd=directory_descriptor)
                os.fsync(directory_descriptor)
                marker = optional(directory_descriptor, marker_name, marker_path)
            else:
                exact_installing_prefix(directory_descriptor, installing_name, installing, content)
                os.unlink(installing_name, dir_fd=directory_descriptor)
                os.fsync(directory_descriptor)
        if verb == 'publish':
            for other_marker_name, other_installing_name in ALLOWED.items():
                if other_marker_name == marker_name:
                    continue
                other_marker_path = os.path.join(directory, other_marker_name)
                other_installing_path = os.path.join(directory, other_installing_name)
                if (
                    optional(
                        directory_descriptor,
                        other_marker_name,
                        other_marker_path,
                    )
                    is not None
                    or optional(
                        directory_descriptor,
                        other_installing_name,
                        other_installing_path,
                    )
                    is not None
                ):
                    reject()
        if verb == 'require':
            exact_marker(directory_descriptor, marker_name, marker_path, content)
        elif verb == 'remove':
            if marker is not None:
                exact_marker(directory_descriptor, marker_name, marker_path, content)
                os.unlink(marker_name, dir_fd=directory_descriptor)
                os.fsync(directory_descriptor)
            if optional(directory_descriptor, marker_name, marker_path) is not None:
                reject()
        else:
            if marker is None:
                installing_descriptor = os.open(
                    installing_name,
                    os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                    0o600,
                    dir_fd=directory_descriptor,
                )
                write_all(installing_descriptor, content)
                os.fchown(installing_descriptor, 0, 10001)
                os.fchmod(installing_descriptor, 0o440)
                os.fsync(installing_descriptor)
                exact_marker(directory_descriptor, installing_name, installing_path, content)
                os.link(
                    installing_name,
                    marker_name,
                    src_dir_fd=directory_descriptor,
                    dst_dir_fd=directory_descriptor,
                    follow_symlinks=False,
                )
                os.fsync(directory_descriptor)
                exact_marker(directory_descriptor, installing_name, installing_path, content, 2)
                exact_marker(directory_descriptor, marker_name, marker_path, content, 2)
                os.unlink(installing_name, dir_fd=directory_descriptor)
                os.fsync(directory_descriptor)
            exact_marker(directory_descriptor, marker_name, marker_path, content)
        if optional(directory_descriptor, installing_name, installing_path) is not None:
            reject()
        if latch is not None:
            exact_recovery_latch(
                directory_descriptor,
                LATCH_NAME,
                latch_path,
                latch_dev_ino,
            )
        if any(entry not in namespace for entry in os.listdir(directory_descriptor)):
            reject()
        require_directory(directory, directory_descriptor)
    finally:
        if installing_descriptor is not None:
            os.close(installing_descriptor)
        os.close(directory_descriptor)


try:
    if len(sys.argv) != 7:
        reject()
    transition(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], sys.argv[6])
except Exception:
    raise SystemExit(1)
PY
}

require_completed_owner_kemerbet_cohort_marker() {
  local claim_id control_mountpoint path
  control_mountpoint="$(resolve_kemerbet_session_control_volume_mountpoint)" || return 1
  path="$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_COMPLETED_CLAIM_NAME"
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%u:%g:%a:%h:%s' "$path")" == '0:10001:440:1:37' ]] ||
    die 'the completed Owner KemerBet cohort marker is absent or unsafe'
  IFS= read -r claim_id <"$path" || die 'the completed Owner KemerBet cohort claim could not be read'
  [[ "$claim_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] ||
    die 'the completed Owner KemerBet cohort claim is invalid'
  cmp -s -- "$path" <(printf '%s\n' "$claim_id") ||
    die 'the completed Owner KemerBet cohort marker content is not exact'
  owner_kemerbet_cohort_marker require-completed "$claim_id" ||
    die 'the completed Owner KemerBet cohort marker changed during inspection'
  for path in \
    "$control_mountpoint/$KEMERBET_OWNER_STAGED_PLAYER_IDS_NAME" \
    "$control_mountpoint/$KEMERBET_OWNER_STAGED_PLAYER_IDS_INSTALLING_NAME" \
    "$control_mountpoint/$KEMERBET_OWNER_STAGED_CLAIM_NAME" \
    "$control_mountpoint/$KEMERBET_OWNER_STAGED_CLAIM_INSTALLING_NAME"; do
    [[ ! -e "$path" && ! -L "$path" ]] ||
      die 'the completed Owner KemerBet cohort retained a staging residue'
  done
  require_legacy_owner_kemerbet_receipt_paths_absent || return 1
  for path in \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_IMPORTED_CLAIM_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_IMPORTED_CLAIM_INSTALLING_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_COMPLETED_CLAIM_INSTALLING_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_FAILED_CLAIM_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_FAILED_CLAIM_INSTALLING_NAME"; do
    [[ ! -e "$path" && ! -L "$path" ]] ||
      die 'the completed Owner KemerBet cohort retained a receipt residue'
  done
}

complete_owner_staged_kemerbet_cohort() {
  consume_owner_staged_kemerbet_cohort || return 1
  owner_kemerbet_cohort_marker remove-imported "$KEMERBET_RECHECK_OWNER_CLAIM_ID" || return 1
  owner_kemerbet_cohort_marker remove-failed "$KEMERBET_RECHECK_OWNER_CLAIM_ID" || return 1
  owner_kemerbet_cohort_marker publish-completed "$KEMERBET_RECHECK_OWNER_CLAIM_ID" || return 1
  owner_kemerbet_cohort_marker require-completed "$KEMERBET_RECHECK_OWNER_CLAIM_ID"
}

restore_retryable_owner_staged_kemerbet_cohort() {
  owner_kemerbet_cohort_marker guard-retry "$KEMERBET_RECHECK_OWNER_CLAIM_ID" || return 1
  restore_owner_staged_kemerbet_cohort || return 1
  owner_kemerbet_cohort_marker guard-retry "$KEMERBET_RECHECK_OWNER_CLAIM_ID" || return 1
  owner_kemerbet_cohort_marker remove-imported "$KEMERBET_RECHECK_OWNER_CLAIM_ID" || return 1
  owner_kemerbet_cohort_marker publish-failed "$KEMERBET_RECHECK_OWNER_CLAIM_ID" || return 1
  owner_kemerbet_cohort_marker require-failed "$KEMERBET_RECHECK_OWNER_CLAIM_ID"
}

resolve_kemerbet_profile_volume_mountpoint() {
  local mountpoint volume_contract volume_name
  volume_name="$(docker_local volume ls --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter 'label=com.docker.compose.volume=kemerbet_sessions')" ||
    die 'the KemerBet profile volume inventory could not be inspected'
  [[ "$volume_name" == "$KEMERBET_PROFILE_VOLUME" ]] ||
    die 'the KemerBet profile volume identity is not exact'
  volume_contract="$(inspect_kemerbet_durable_volume_contract \
    "$volume_name" kemerbet_sessions)" ||
    die 'the KemerBet profile volume contract is not exact'
  mountpoint="${volume_contract##*|}"
  [[ "$mountpoint" == /* && ! -L "$mountpoint" && -d "$mountpoint" ]] ||
    die 'the KemerBet profile volume mountpoint is unsafe'
  [[ "$(realpath -- "$mountpoint")" == "$mountpoint" ]] ||
    die 'the KemerBet profile volume mountpoint is not canonical'
  [[ "$(stat --format='%u:%g:%a' "$mountpoint")" == '10001:10001:700' ]] ||
    die 'the KemerBet profile volume root ownership or mode is unsafe'
  printf '%s' "$mountpoint"
}

kemerbet_profile_volume_holders_match() {
  local expected_container_id="$1" holders
  holders="$(docker_local container ls --all --quiet --filter "volume=$KEMERBET_PROFILE_VOLUME")" ||
    return 1
  [[ "$holders" == "$expected_container_id" ]]
}

require_kemerbet_profile_volume_holders() {
  kemerbet_profile_volume_holders_match "$1" ||
    die 'the KemerBet profile volume has an unexpected concurrent holder'
}

kemerbet_profile_identity_digest() {
  [[ $# -eq 3 ]] || die 'the KemerBet profile singleton policy is invalid'
  local account_id="$1" mountpoint="$2" singleton_policy="$3"
  local digest mountpoint_stat profile_path profile_stat root_entries singleton singleton_path
  local singleton_stat
  [[ "$account_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ &&
    "$account_id" != '00000000-0000-0000-0000-000000000000' ]] ||
    die 'the KemerBet profile account identity is invalid'
  case "$singleton_policy" in
    allow-exact-stale-singletons) require_kemerbet_profile_volume_holders '' || return 1 ;;
    require-absent-singletons) ;;
    *) die 'the KemerBet profile singleton policy is invalid' ;;
  esac
  profile_path="$mountpoint/$account_id"
  [[ ! -L "$profile_path" && -d "$profile_path" ]] ||
    die 'the exact KemerBet profile is absent or symbolic'
  [[ "$(realpath -- "$profile_path")" == "$profile_path" ]] ||
    die 'the exact KemerBet profile is not canonical'
  [[ "$(stat --format='%u:%g:%a' "$profile_path")" == '10001:10001:700' ]] ||
    die 'the exact KemerBet profile ownership or mode is unsafe'
  root_entries="$(find -P "$mountpoint" -mindepth 1 -maxdepth 1 -printf '%f\n')" ||
    die 'the KemerBet profile root could not be inspected'
  [[ "$root_entries" == "$account_id" ]] || die 'the KemerBet profile root is not exact'
  for singleton in SingletonCookie SingletonLock SingletonSocket; do
    singleton_path="$profile_path/$singleton"
    if [[ ! -e "$singleton_path" && ! -L "$singleton_path" ]]; then
      continue
    fi
    [[ "$singleton_policy" == 'allow-exact-stale-singletons' && -L "$singleton_path" ]] ||
      die 'the KemerBet profile retains an active or unsafe Chromium singleton artifact'
    singleton_stat="$(stat --format='%u:%g:%a:%h' -- "$singleton_path")" ||
      die 'the KemerBet profile singleton metadata could not be inspected'
    [[ "$singleton_stat" == '10001:10001:777:1' ]] ||
      die 'the KemerBet profile singleton metadata is unsafe'
  done
  mountpoint_stat="$(stat --format='%d:%i:%u:%g:%a' "$mountpoint")" || return 1
  profile_stat="$(stat --format='%d:%i:%u:%g:%a' "$profile_path")" || return 1
  digest="$(printf 'volume=%s\nroot=%s\nprofile=%s\naccount=%s\n' \
    "$KEMERBET_PROFILE_VOLUME" \
    "$mountpoint_stat" \
    "$profile_stat" \
    "$account_id" | sha256sum | awk '{print $1}')" || return 1
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s' "$digest"
}

require_kemerbet_recheck_engine_boundary() {
  local docker_version major
  for utility in nsenter iptables-restore ip6tables-restore iptables-save ip6tables-save; do
    command -v "$utility" >/dev/null 2>&1 || return 1
  done
  docker_version="$(docker_local version --format '{{.Server.Version}}')" || return 1
  [[ "$docker_version" =~ ^([0-9]+)\.[0-9]+(\.[0-9]+)?([+~-][0-9A-Za-z._-]+)?$ ]] || return 1
  major="${BASH_REMATCH[1]}"
  [[ "$major" =~ ^[0-9]+$ ]] || return 1
  (( major >= 28 ))
}

require_kemerbet_recheck_container_contract() {
  local container_id="$1" role="$2" commit_sha="$3" image_tag="$4" image_id="$5"
  local command_json expected_command expected_dns expected_mounts expected_network_mode
  local expected_service expected_user host_contract mountpoint observed_mounts observed_networks
  local expected_dns_options expected_name expected_runtime_environment expected_stop_timeout
  local expected_tmpfs observed_health_contract
  local observed_health_test_digest observed_runtime_environment
  case "$role" in
    controller)
      expected_name="$KEMERBET_RECHECK_CONTAINER"
      expected_service='kemerbet-no-transfer-readiness'
      expected_user='10002:10002'
      expected_command='["node","apps/executor/dist/kemerbet-no-transfer-readiness.js"]'
      expected_network_mode="$KEMERBET_RECHECK_CONTROL_NETWORK"
      expected_dns='["127.0.0.1"]'
      expected_dns_options='["attempts:1","timeout:1","ndots:0"]'
      expected_stop_timeout='15'
      expected_tmpfs='{"/tmp":"rw,noexec,nosuid,nodev,size=33554432,mode=1777"}'
      expected_mounts="$(printf '%s\n' \
        "bind||/run/secrets/kemerbet_agent_identity_bindings|false|$KEMERBET_RECHECK_CANDIDATE_BINDING" \
        "bind||/run/secrets/kemerbet_agent_identity_hmac_key|false|$KEMERBET_AGENT_IDENTITY_HMAC_KEY" \
        "bind||/run/secrets/kemerbet_no_transfer_readiness_player_ids|false|$KEMERBET_READINESS_PLAYER_IDS" \
        "bind||/run/fetanagent-kemerbet-readiness-controller-stage-output|true|$KEMERBET_RECHECK_CONTROLLER_STAGE_OUTPUT_ROOT" \
        "bind||/run/secrets/kemerbet_readiness_browser_rpc_capability|false|$KEMERBET_RECHECK_RPC_CONTROLLER_CAPABILITY" \
        "bind||/run/secrets/kemerbet_readiness_controller_firewall_release|false|$KEMERBET_RECHECK_CONTROLLER_FIREWALL_RELEASE" \
        "bind||/run/secrets/kemerbet_readiness_layer7_authorizations|false|$KEMERBET_RECHECK_AUTHORIZATIONS" | LC_ALL=C sort)"
      expected_runtime_environment="$(printf '%s\n' \
        'ALL_PROXY=' \
        'FINANCIAL_ACTIONS_MODE=dry_run' \
        'FTP_PROXY=' \
        'HTTPS_PROXY=' \
        'HTTP_PROXY=' \
        'INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED=false' \
        'KEMERBET_EXECUTOR_ENABLED=false' \
        'KEMERBET_FINAL_ACTION_ENABLED=false' \
        'KEMERBET_NO_TRANSFER_READINESS_ENABLED=true' \
        'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=false' \
        'KEMERBET_READINESS_BROWSER_RPC_ENABLED=true' \
        'NODE_ENV=production' \
        'NO_PROXY=' \
        'all_proxy=' \
        'ftp_proxy=' \
        'https_proxy=' \
        'http_proxy=' \
        'no_proxy=' | LC_ALL=C sort)"
      ;;
    browser)
      expected_name="$KEMERBET_RECHECK_BROWSER_CONTAINER"
      expected_service='kemerbet-readiness-browser'
      expected_user='10001:10001'
      expected_command='["node","apps/executor/dist/kemerbet-readiness-browser-driver.js"]'
      expected_network_mode="$KEMERBET_RECHECK_CONTROL_NETWORK"
      expected_dns='["127.0.0.1"]'
      expected_dns_options='["attempts:1","timeout:1","ndots:0"]'
      expected_stop_timeout='60'
      expected_tmpfs='{"/tmp":"rw,noexec,nosuid,nodev,size=268435456,mode=1777"}'
      mountpoint="$(docker_local volume inspect "$KEMERBET_RECHECK_PROFILE_SNAPSHOT_VOLUME" \
        --format '{{.Mountpoint}}')" || return 1
      [[ "$mountpoint" == /var/lib/docker/volumes/*/_data ]] || return 1
      expected_mounts="$(printf '%s\n' \
        "bind||/etc/fetanagent/kemerbet-selector-contract.v2.json|false|$KEMERBET_SELECTOR_CONTRACT" \
        "bind||/run/fetanagent-kemerbet-readiness-browser-stage-output|true|$KEMERBET_RECHECK_BROWSER_STAGE_OUTPUT_ROOT" \
        "bind||/run/secrets/kemerbet_readiness_account_id|false|$KEMERBET_RECHECK_BROWSER_ACCOUNT_ID" \
        "bind||/run/secrets/kemerbet_readiness_browser_firewall_release|false|$KEMERBET_RECHECK_BROWSER_FIREWALL_RELEASE" \
        "bind||/run/secrets/kemerbet_readiness_browser_rpc_capability|false|$KEMERBET_RECHECK_RPC_BROWSER_CAPABILITY" \
        "volume|$KEMERBET_RECHECK_PROFILE_SNAPSHOT_VOLUME|/var/lib/fetanagent/kemerbet-sessions|true|$mountpoint" | LC_ALL=C sort)"
      expected_runtime_environment="$(printf '%s\n' \
        'ALL_PROXY=' \
        'FINANCIAL_ACTIONS_MODE=dry_run' \
        'FTP_PROXY=' \
        'HTTPS_PROXY=' \
        'HTTP_PROXY=' \
        'INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED=false' \
        'KEMERBET_EXECUTOR_ENABLED=false' \
        'KEMERBET_FINAL_ACTION_ENABLED=false' \
        'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=false' \
        'KEMERBET_READINESS_BROWSER_DRIVER_ENABLED=true' \
        "KEMERBET_READINESS_L7_PROXY_IPV4=$KEMERBET_RECHECK_PROXY_PROXY_IPV4" \
        'KEMERBET_READINESS_L7_PROXY_SPKI_SHA256=Ngu9uL2STHWC7Uton/GYw7d8hDQdhliykEz2XnJZd3M=' \
        'NODE_ENV=production' \
        'NO_PROXY=' \
        'all_proxy=' \
        'ftp_proxy=' \
        'https_proxy=' \
        'http_proxy=' \
        'no_proxy=' | LC_ALL=C sort)"
      ;;
    proxy)
      expected_name="$KEMERBET_RECHECK_PROXY_CONTAINER"
      expected_service='kemerbet-readiness-egress-proxy'
      expected_user='10003:10003'
      expected_command='["node","apps/executor/dist/kemerbet-readiness-layer7-proxy.js"]'
      # Compose sorts equal-priority networks by logical service network key before choosing the
      # container's primary NetworkMode. The egress network sorts before the
      # private proxy network; the exact two-network membership is re-attested
      # independently below.
      expected_network_mode="$KEMERBET_RECHECK_EGRESS_NETWORK"
      expected_dns='null'
      expected_dns_options='null'
      expected_stop_timeout='15'
      expected_tmpfs='{"/tmp":"rw,noexec,nosuid,nodev,size=33554432,mode=1777"}'
      expected_mounts="$(printf '%s\n' \
        "bind||/run/fetanagent-kemerbet-readiness-proxy-stage-output|true|$KEMERBET_RECHECK_PROXY_STAGE_OUTPUT_ROOT" \
        "bind||/run/output|true|$KEMERBET_RECHECK_PROXY_OUTPUT_ROOT" \
        "bind||/run/secrets/kemerbet_readiness_proxy_agent_identity_bindings|false|$KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_BINDINGS" \
        "bind||/run/secrets/kemerbet_readiness_proxy_agent_identity_hmac_key|false|$KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_HMAC_KEY" \
        "bind||/run/secrets/kemerbet_readiness_proxy_hmac_key|false|$KEMERBET_RECHECK_PROXY_HMAC_KEY" \
        "bind||/run/secrets/kemerbet_readiness_proxy_run_nonce|false|$KEMERBET_RECHECK_PROXY_RUN_NONCE" \
        "bind||/run/secrets/kemerbet_readiness_release_sha|false|$KEMERBET_RECHECK_RELEASE_SHA" | LC_ALL=C sort)"
      expected_runtime_environment="$(printf '%s\n' \
        'ALL_PROXY=' \
        'FINANCIAL_ACTIONS_MODE=dry_run' \
        'FTP_PROXY=' \
        'HTTPS_PROXY=' \
        'HTTP_PROXY=' \
        'INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED=false' \
        'KEMERBET_EXECUTOR_ENABLED=false' \
        'KEMERBET_FINAL_ACTION_ENABLED=false' \
        'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=false' \
        'NODE_ENV=production' \
        'NO_PROXY=' \
        'all_proxy=' \
        'ftp_proxy=' \
        'https_proxy=' \
        'http_proxy=' \
        'no_proxy=' | LC_ALL=C sort)"
      ;;
    *) return 1 ;;
  esac
  [[ "$container_id" =~ ^[0-9a-f]{64}$ ]] || return 1
  [[ "$(docker_local container inspect "$container_id" \
    --format '{{.Id}}|{{.Name}}|{{.Image}}|{{ index .Config.Labels "com.docker.compose.project" }}|{{ index .Config.Labels "com.docker.compose.service" }}')" == \
    "$container_id|/$expected_name|$image_id|$PROJECT_NAME|$expected_service" ]] || return 1
  [[ "$(docker_local image inspect "fetanagent-deposit-executor:$image_tag" \
    --format '{{.Id}}|{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == \
    "$image_id|$commit_sha" ]] || return 1
  command_json="$(docker_local container inspect "$container_id" --format '{{json .Config.Cmd}}')" ||
    return 1
  [[ "$command_json" == "$expected_command" ]] || return 1
  host_contract="$(docker_local container inspect "$container_id" \
    --format '{{.Config.User}}|{{.HostConfig.ReadonlyRootfs}}|{{.HostConfig.Privileged}}|{{.HostConfig.Init}}|{{.HostConfig.PidMode}}|{{.HostConfig.NetworkMode}}|{{.HostConfig.LogConfig.Type}}|{{.HostConfig.RestartPolicy.Name}}|{{.HostConfig.AutoRemove}}|{{json .HostConfig.CapAdd}}|{{json .HostConfig.CapDrop}}|{{json .HostConfig.SecurityOpt}}|{{json .HostConfig.PortBindings}}|{{json .HostConfig.Dns}}|{{json .HostConfig.DnsOptions}}|{{json .HostConfig.Tmpfs}}|{{json .Config.StopTimeout}}')" ||
    return 1
  [[ "$host_contract" == \
    "$expected_user|true|false|true||$expected_network_mode|none|no|false|null|[\"ALL\"]|[\"no-new-privileges:true\"]|{}|$expected_dns|$expected_dns_options|$expected_tmpfs|$expected_stop_timeout" ]] ||
    return 1
  case "$role" in
    controller|proxy)
      [[ "$(docker_local container inspect "$container_id" \
        --format '{{.HostConfig.Memory}}|{{.HostConfig.NanoCpus}}|{{.HostConfig.PidsLimit}}')" == \
        '134217728|500000000|64' ]] || return 1
      ;;
    browser)
      [[ "$(docker_local container inspect "$container_id" \
        --format '{{.HostConfig.Memory}}|{{.HostConfig.NanoCpus}}|{{.HostConfig.PidsLimit}}|{{.HostConfig.ShmSize}}')" == \
        '1610612736|2000000000|512|536870912' ]] || return 1
      ;;
  esac
  if [[ "$role" == 'proxy' ]]; then
    observed_health_contract="$(docker_local container inspect "$container_id" \
      --format '{{json .Config.Healthcheck.Interval}}|{{json .Config.Healthcheck.Timeout}}|{{json .Config.Healthcheck.StartPeriod}}|{{json .Config.Healthcheck.Retries}}')" ||
      return 1
    [[ "$observed_health_contract" == '1000000000|1000000000|90000000000|120' ]] ||
      return 1
    observed_health_test_digest="$(docker_local container inspect "$container_id" \
      --format '{{range $index, $value := .Config.Healthcheck.Test}}{{if $index}}{{print "\n"}}{{end}}{{print $value}}{{end}}' | \
      sha256sum | awk '{print $1}')" || return 1
    [[ "$observed_health_test_digest" == "$KEMERBET_RECHECK_PROXY_HEALTH_TEST_SHA256" ]] ||
      return 1
  fi
  observed_mounts="$(docker_local container inspect "$container_id" \
    --format '{{range .Mounts}}{{printf "%s|%s|%s|%t|%s\n" .Type .Name .Destination .RW .Source}}{{end}}' | \
    LC_ALL=C sed '/^$/d' | \
    LC_ALL=C sort)" || return 1
  [[ "$observed_mounts" == "$expected_mounts" ]] || return 1
  observed_networks="$(docker_local container inspect "$container_id" \
    --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' | \
    LC_ALL=C sed '/^$/d' | \
    LC_ALL=C sort)" ||
    return 1
  case "$role" in
    controller)
      [[ "$observed_networks" == "$KEMERBET_RECHECK_CONTROL_NETWORK" ]] || return 1
      ;;
    browser)
      [[ "$observed_networks" == "$(printf '%s\n' \
        "$KEMERBET_RECHECK_CONTROL_NETWORK" "$KEMERBET_RECHECK_PROXY_NETWORK" | LC_ALL=C sort)" ]] ||
        return 1
      ;;
    proxy)
      [[ "$observed_networks" == "$(printf '%s\n' \
        "$KEMERBET_RECHECK_EGRESS_NETWORK" "$KEMERBET_RECHECK_PROXY_NETWORK" | LC_ALL=C sort)" ]] ||
        return 1
      ;;
  esac
  observed_runtime_environment="$(docker_local container inspect "$container_id" \
    --format '{{range .Config.Env}}{{println .}}{{end}}' | \
    LC_ALL=C grep -E '^(ALL_PROXY|FINANCIAL_ACTIONS_MODE|FTP_PROXY|HTTPS_PROXY|HTTP_PROXY|INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED|KEMERBET_[A-Z0-9_]+|NODE_ENV|NO_PROXY|all_proxy|ftp_proxy|https_proxy|http_proxy|no_proxy)=' | \
    LC_ALL=C sort)" || return 1
  [[ "$observed_runtime_environment" == "$expected_runtime_environment" ]]
}

require_kemerbet_recheck_running_network_contract() {
  local browser_id="$1" controller_id="$2" proxy_id="$3"
  [[ "$(docker_local container inspect "$controller_id" \
    --format "{{with index .NetworkSettings.Networks \"$KEMERBET_RECHECK_CONTROL_NETWORK\"}}{{.IPAddress}}|{{.GlobalIPv6Address}}{{end}}")" == \
    "$KEMERBET_RECHECK_CONTROLLER_CONTROL_IPV4|$KEMERBET_RECHECK_CONTROLLER_CONTROL_IPV6" ]] ||
    return 1
  [[ "$(docker_local container inspect "$browser_id" \
    --format "{{with index .NetworkSettings.Networks \"$KEMERBET_RECHECK_CONTROL_NETWORK\"}}{{.IPAddress}}|{{.GlobalIPv6Address}}{{end}}")" == \
    "$KEMERBET_RECHECK_BROWSER_CONTROL_IPV4|$KEMERBET_RECHECK_BROWSER_CONTROL_IPV6" ]] ||
    return 1
  [[ "$(docker_local container inspect "$browser_id" \
    --format "{{with index .NetworkSettings.Networks \"$KEMERBET_RECHECK_PROXY_NETWORK\"}}{{.IPAddress}}|{{.GlobalIPv6Address}}{{end}}")" == \
    "$KEMERBET_RECHECK_BROWSER_PROXY_IPV4|$KEMERBET_RECHECK_BROWSER_PROXY_IPV6" ]] ||
    return 1
  [[ "$(docker_local container inspect "$proxy_id" \
    --format "{{with index .NetworkSettings.Networks \"$KEMERBET_RECHECK_PROXY_NETWORK\"}}{{.IPAddress}}|{{.GlobalIPv6Address}}{{end}}")" == \
    "$KEMERBET_RECHECK_PROXY_PROXY_IPV4|$KEMERBET_RECHECK_PROXY_PROXY_IPV6" ]] ||
    return 1
  [[ -n "$(docker_local container inspect "$proxy_id" \
    --format "{{with index .NetworkSettings.Networks \"$KEMERBET_RECHECK_EGRESS_NETWORK\"}}{{.IPAddress}}{{end}}")" ]] ||
    return 1
  [[ "$(docker_local network inspect "$KEMERBET_RECHECK_CONTROL_NETWORK" \
    --format '{{range $id, $_ := .Containers}}{{println $id}}{{end}}' | \
    LC_ALL=C sed '/^$/d' | \
    LC_ALL=C sort)" == \
    "$(printf '%s\n' "$browser_id" "$controller_id" | LC_ALL=C sort)" ]] || return 1
  [[ "$(docker_local network inspect "$KEMERBET_RECHECK_PROXY_NETWORK" \
    --format '{{range $id, $_ := .Containers}}{{println $id}}{{end}}' | \
    LC_ALL=C sed '/^$/d' | \
    LC_ALL=C sort)" == \
    "$(printf '%s\n' "$browser_id" "$proxy_id" | LC_ALL=C sort)" ]] || return 1
  [[ "$(docker_local network inspect "$KEMERBET_RECHECK_EGRESS_NETWORK" \
    --format '{{range $id, $_ := .Containers}}{{println $id}}{{end}}')" == "$proxy_id" ]] || return 1
}

pin_kemerbet_recheck_network_namespace() {
  local container_id="$1" role="$2" expected_network observed netns_fd netns_path
  local path_identity path_identity_after namespace_identity namespace_identity_after
  local descriptor_identity descriptor_target host_namespace_identity
  local observed_id observed_network observed_paused observed_pid observed_running
  [[ "$container_id" =~ ^[0-9a-f]{64}$ ]] || return 1
  case "$role" in
    controller)
      [[ -z "$KEMERBET_RECHECK_CONTROLLER_NETNS_FD" ]] || return 1
      expected_network="$KEMERBET_RECHECK_CONTROL_NETWORK"
      ;;
    browser)
      [[ -z "$KEMERBET_RECHECK_BROWSER_NETNS_FD" ]] || return 1
      expected_network="$KEMERBET_RECHECK_CONTROL_NETWORK"
      ;;
    *) return 1 ;;
  esac
  observed="$(docker_local container inspect "$container_id" \
    --format '{{.Id}}|{{.State.Pid}}|{{.State.Running}}|{{.State.Paused}}|{{.HostConfig.NetworkMode}}')" ||
    return 1
  IFS='|' read -r observed_id observed_pid observed_running observed_paused observed_network <<<"$observed"
  [[ "$observed_id" == "$container_id" && "$observed_pid" =~ ^[1-9][0-9]*$ &&
    "$observed_running" == 'true' && "$observed_paused" == 'false' &&
    "$observed_network" == "$expected_network" ]] || return 1
  netns_path="/proc/$observed_pid/ns/net"
  [[ -d /proc/self/fd && ! -L /proc/self/fd && -e "$netns_path" ]] || return 1
  namespace_identity="$(readlink -- "$netns_path")" || return 1
  host_namespace_identity="$(readlink -- /proc/self/ns/net)" || return 1
  [[ "$namespace_identity" =~ ^net:\[[0-9]+\]$ &&
    "$host_namespace_identity" =~ ^net:\[[0-9]+\]$ &&
    "$namespace_identity" != "$host_namespace_identity" ]] || return 1
  path_identity="$(stat -L --format='%d:%i' "$netns_path")" || return 1
  exec {netns_fd}<"$netns_path" || return 1
  descriptor_identity="$(stat -L --format='%d:%i' "/proc/self/fd/$netns_fd")" || {
    exec {netns_fd}<&-
    return 1
  }
  descriptor_target="$(readlink -- "/proc/self/fd/$netns_fd")" || {
    exec {netns_fd}<&-
    return 1
  }
  observed="$(docker_local container inspect "$container_id" \
    --format '{{.Id}}|{{.State.Pid}}|{{.State.Running}}|{{.State.Paused}}|{{.HostConfig.NetworkMode}}')" || {
    exec {netns_fd}<&-
    return 1
  }
  path_identity_after="$(stat -L --format='%d:%i' "$netns_path")" || {
    exec {netns_fd}<&-
    return 1
  }
  namespace_identity_after="$(readlink -- "$netns_path")" || {
    exec {netns_fd}<&-
    return 1
  }
  if [[ "$observed" != "$container_id|$observed_pid|true|false|$expected_network" ||
    "$descriptor_identity" != "$path_identity" ||
    "$path_identity_after" != "$path_identity" ||
    "$descriptor_target" != "$namespace_identity" ||
    "$namespace_identity_after" != "$namespace_identity" ]]; then
    exec {netns_fd}<&-
    return 1
  fi
  case "$role" in
    controller)
      KEMERBET_RECHECK_CONTROLLER_NETNS_FD="$netns_fd"
      KEMERBET_RECHECK_CONTROLLER_NETNS_CONTAINER_ID="$container_id"
      KEMERBET_RECHECK_CONTROLLER_NETNS_PID="$observed_pid"
      KEMERBET_RECHECK_CONTROLLER_NETNS_IDENTITY="$namespace_identity"
      ;;
    browser)
      KEMERBET_RECHECK_BROWSER_NETNS_FD="$netns_fd"
      KEMERBET_RECHECK_BROWSER_NETNS_CONTAINER_ID="$container_id"
      KEMERBET_RECHECK_BROWSER_NETNS_PID="$observed_pid"
      KEMERBET_RECHECK_BROWSER_NETNS_IDENTITY="$namespace_identity"
      ;;
  esac
}

require_pinned_kemerbet_recheck_network_namespace() {
  local container_id="$1" role="$2" expected_network descriptor descriptor_identity
  local expected_container_id expected_identity expected_pid namespace_identity
  local observed_before observed_after path_identity path_namespace_identity
  case "$role" in
    controller)
      descriptor="$KEMERBET_RECHECK_CONTROLLER_NETNS_FD"
      expected_container_id="$KEMERBET_RECHECK_CONTROLLER_NETNS_CONTAINER_ID"
      expected_pid="$KEMERBET_RECHECK_CONTROLLER_NETNS_PID"
      expected_identity="$KEMERBET_RECHECK_CONTROLLER_NETNS_IDENTITY"
      expected_network="$KEMERBET_RECHECK_CONTROL_NETWORK"
      ;;
    browser)
      descriptor="$KEMERBET_RECHECK_BROWSER_NETNS_FD"
      expected_container_id="$KEMERBET_RECHECK_BROWSER_NETNS_CONTAINER_ID"
      expected_pid="$KEMERBET_RECHECK_BROWSER_NETNS_PID"
      expected_identity="$KEMERBET_RECHECK_BROWSER_NETNS_IDENTITY"
      expected_network="$KEMERBET_RECHECK_CONTROL_NETWORK"
      ;;
    *) return 1 ;;
  esac
  [[ "$container_id" =~ ^[0-9a-f]{64}$ && "$descriptor" =~ ^[1-9][0-9]*$ &&
    "$expected_container_id" == "$container_id" && "$expected_pid" =~ ^[1-9][0-9]*$ &&
    "$expected_identity" =~ ^net:\[[0-9]+\]$ ]] || return 1
  [[ -e "/proc/self/fd/$descriptor" ]] || return 1
  descriptor_identity="$(stat -L --format='%d:%i' "/proc/self/fd/$descriptor")" || return 1
  namespace_identity="$(readlink -- "/proc/self/fd/$descriptor")" || return 1
  observed_before="$(docker_local container inspect "$container_id" \
    --format '{{.Id}}|{{.State.Pid}}|{{.State.Running}}|{{.State.Paused}}|{{.HostConfig.NetworkMode}}')" ||
    return 1
  path_identity="$(stat -L --format='%d:%i' "/proc/$expected_pid/ns/net")" || return 1
  path_namespace_identity="$(readlink -- "/proc/$expected_pid/ns/net")" || return 1
  observed_after="$(docker_local container inspect "$container_id" \
    --format '{{.Id}}|{{.State.Pid}}|{{.State.Running}}|{{.State.Paused}}|{{.HostConfig.NetworkMode}}')" ||
    return 1
  [[ "$observed_before" == "$container_id|$expected_pid|true|false|$expected_network" &&
    "$observed_after" == "$observed_before" &&
    "$namespace_identity" == "$expected_identity" &&
    "$path_namespace_identity" == "$expected_identity" &&
    "$descriptor_identity" == "$path_identity" ]]
}

close_pinned_kemerbet_recheck_network_namespace() {
  local role="$1" descriptor descriptor_number
  case "$role" in
    controller) descriptor="$KEMERBET_RECHECK_CONTROLLER_NETNS_FD" ;;
    browser) descriptor="$KEMERBET_RECHECK_BROWSER_NETNS_FD" ;;
    *) return 1 ;;
  esac
  [[ -z "$descriptor" ]] && return 0
  [[ "$descriptor" =~ ^[1-9][0-9]*$ && -e "/proc/self/fd/$descriptor" ]] || return 1
  descriptor_number="$descriptor"
  exec {descriptor}<&- || return 1
  case "$role" in
    controller)
      KEMERBET_RECHECK_CONTROLLER_NETNS_FD=''
      KEMERBET_RECHECK_CONTROLLER_NETNS_CONTAINER_ID=''
      KEMERBET_RECHECK_CONTROLLER_NETNS_PID=''
      KEMERBET_RECHECK_CONTROLLER_NETNS_IDENTITY=''
      ;;
    browser)
      KEMERBET_RECHECK_BROWSER_NETNS_FD=''
      KEMERBET_RECHECK_BROWSER_NETNS_CONTAINER_ID=''
      KEMERBET_RECHECK_BROWSER_NETNS_PID=''
      KEMERBET_RECHECK_BROWSER_NETNS_IDENTITY=''
      ;;
  esac
  [[ ! -e "/proc/self/fd/$descriptor_number" ]]
}

close_all_pinned_kemerbet_recheck_network_namespaces() {
  local status=0
  close_pinned_kemerbet_recheck_network_namespace controller || status=1
  close_pinned_kemerbet_recheck_network_namespace browser || status=1
  return "$status"
}

normalized_kemerbet_recheck_firewall_digest() {
  local netns_fd="$1" family="$2" save_utility
  [[ "$netns_fd" =~ ^[1-9][0-9]*$ && -e "/proc/self/fd/$netns_fd" ]] || return 1
  case "$family" in
    4) save_utility='iptables-save' ;;
    6) save_utility='ip6tables-save' ;;
    *) return 1 ;;
  esac
  env -i PATH="$SAFE_PATH" nsenter --net="/proc/self/fd/$netns_fd" -- "$save_utility" -t filter | \
    LC_ALL=C sed -E '/^#/d;s/\[[0-9]+:[0-9]+\]/[0:0]/g' | sha256sum | awk '{print $1}'
}

install_kemerbet_recheck_network_firewall() {
  local container_id="$1" role="$2" netns_fd v4_digest v6_digest
  [[ "$container_id" =~ ^[0-9a-f]{64}$ ]] || return 1
  pin_kemerbet_recheck_network_namespace "$container_id" "$role" || return 1
  require_pinned_kemerbet_recheck_network_namespace "$container_id" "$role" || return 1
  case "$role" in
    controller) netns_fd="$KEMERBET_RECHECK_CONTROLLER_NETNS_FD" ;;
    browser) netns_fd="$KEMERBET_RECHECK_BROWSER_NETNS_FD" ;;
    *) return 1 ;;
  esac
  [[ "$(docker_local container inspect "$container_id" \
    --format '{{json .HostConfig.CapAdd}}|{{json .HostConfig.CapDrop}}')" == 'null|["ALL"]' ]] ||
    return 1
  case "$role" in
    controller)
      env -i PATH="$SAFE_PATH" nsenter --net="/proc/self/fd/$netns_fd" -- iptables-restore <<EOF
*filter
:INPUT ACCEPT [0:0]
:FORWARD DROP [0:0]
:OUTPUT DROP [0:0]
:$KEMERBET_RECHECK_FIREWALL_CHAIN - [0:0]
-A INPUT -i lo -j ACCEPT
-A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
-A INPUT -j REJECT --reject-with icmp-port-unreachable
-A OUTPUT -j $KEMERBET_RECHECK_FIREWALL_CHAIN
-A $KEMERBET_RECHECK_FIREWALL_CHAIN -d 127.0.0.11/32 -j REJECT --reject-with icmp-port-unreachable
-A $KEMERBET_RECHECK_FIREWALL_CHAIN -o lo -j ACCEPT
-A $KEMERBET_RECHECK_FIREWALL_CHAIN -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
-A $KEMERBET_RECHECK_FIREWALL_CHAIN -p tcp -d $KEMERBET_RECHECK_BROWSER_CONTROL_IPV4 --dport 4587 -j ACCEPT
-A $KEMERBET_RECHECK_FIREWALL_CHAIN -j REJECT --reject-with icmp-port-unreachable
COMMIT
EOF
      ;;
    browser)
      env -i PATH="$SAFE_PATH" nsenter --net="/proc/self/fd/$netns_fd" -- iptables-restore <<EOF
*filter
:INPUT ACCEPT [0:0]
:FORWARD DROP [0:0]
:OUTPUT DROP [0:0]
:$KEMERBET_RECHECK_FIREWALL_CHAIN - [0:0]
-A INPUT -i lo -j ACCEPT
-A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
-A INPUT -p tcp -s $KEMERBET_RECHECK_CONTROLLER_CONTROL_IPV4 -d $KEMERBET_RECHECK_BROWSER_CONTROL_IPV4 --dport 4587 -j ACCEPT
-A INPUT -p tcp -s $KEMERBET_RECHECK_BROWSER_CONTROL_IPV4 -d $KEMERBET_RECHECK_BROWSER_CONTROL_IPV4 --dport 4587 -j ACCEPT
-A INPUT -j REJECT --reject-with icmp-port-unreachable
-A OUTPUT -j $KEMERBET_RECHECK_FIREWALL_CHAIN
-A $KEMERBET_RECHECK_FIREWALL_CHAIN -d 127.0.0.11/32 -j REJECT --reject-with icmp-port-unreachable
-A $KEMERBET_RECHECK_FIREWALL_CHAIN -o lo -j ACCEPT
-A $KEMERBET_RECHECK_FIREWALL_CHAIN -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
-A $KEMERBET_RECHECK_FIREWALL_CHAIN -p tcp -d $KEMERBET_RECHECK_PROXY_PROXY_IPV4 --dport 18443 -j ACCEPT
-A $KEMERBET_RECHECK_FIREWALL_CHAIN -p tcp -d $KEMERBET_RECHECK_BROWSER_CONTROL_IPV4 --dport 4587 -j ACCEPT
-A $KEMERBET_RECHECK_FIREWALL_CHAIN -j REJECT --reject-with icmp-port-unreachable
COMMIT
EOF
      ;;
    *) return 1 ;;
  esac
  require_pinned_kemerbet_recheck_network_namespace "$container_id" "$role" || return 1
  env -i PATH="$SAFE_PATH" nsenter --net="/proc/self/fd/$netns_fd" -- ip6tables-restore <<EOF
*filter
:INPUT ACCEPT [0:0]
:FORWARD DROP [0:0]
:OUTPUT DROP [0:0]
:$KEMERBET_RECHECK_FIREWALL_CHAIN - [0:0]
-A INPUT -i lo -j ACCEPT
-A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
-A INPUT -j REJECT --reject-with icmp6-port-unreachable
-A OUTPUT -j $KEMERBET_RECHECK_FIREWALL_CHAIN
-A $KEMERBET_RECHECK_FIREWALL_CHAIN -o lo -j ACCEPT
-A $KEMERBET_RECHECK_FIREWALL_CHAIN -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
-A $KEMERBET_RECHECK_FIREWALL_CHAIN -j REJECT --reject-with icmp6-port-unreachable
COMMIT
EOF
  require_pinned_kemerbet_recheck_network_namespace "$container_id" "$role" || return 1
  [[ "$(env -i PATH="$SAFE_PATH" nsenter --net="/proc/self/fd/$netns_fd" -- iptables -S OUTPUT)" == \
    $'-P OUTPUT DROP\n-A OUTPUT -j '"$KEMERBET_RECHECK_FIREWALL_CHAIN" ]] || return 1
  [[ "$(env -i PATH="$SAFE_PATH" nsenter --net="/proc/self/fd/$netns_fd" -- ip6tables -S OUTPUT)" == \
    $'-P OUTPUT DROP\n-A OUTPUT -j '"$KEMERBET_RECHECK_FIREWALL_CHAIN" ]] || return 1
  [[ "$(env -i PATH="$SAFE_PATH" nsenter --net="/proc/self/fd/$netns_fd" -- iptables -S "$KEMERBET_RECHECK_FIREWALL_CHAIN" | \
    sed -n '2p')" == "-A $KEMERBET_RECHECK_FIREWALL_CHAIN -d 127.0.0.11/32 -j REJECT --reject-with icmp-port-unreachable" ]] ||
    return 1
  [[ "$(env -i PATH="$SAFE_PATH" nsenter --net="/proc/self/fd/$netns_fd" -- ip6tables -S "$KEMERBET_RECHECK_FIREWALL_CHAIN" | \
    sed -n '$p')" == "-A $KEMERBET_RECHECK_FIREWALL_CHAIN -j REJECT --reject-with icmp6-port-unreachable" ]] ||
    return 1
  v4_digest="$(normalized_kemerbet_recheck_firewall_digest "$netns_fd" 4)" || return 1
  v6_digest="$(normalized_kemerbet_recheck_firewall_digest "$netns_fd" 6)" || return 1
  [[ "$v4_digest" =~ ^[0-9a-f]{64}$ && "$v6_digest" =~ ^[0-9a-f]{64}$ ]] || return 1
  case "$role" in
    controller)
      KEMERBET_RECHECK_CONTROLLER_FIREWALL_V4_DIGEST="$v4_digest"
      KEMERBET_RECHECK_CONTROLLER_FIREWALL_V6_DIGEST="$v6_digest"
      ;;
    browser)
      KEMERBET_RECHECK_BROWSER_FIREWALL_V4_DIGEST="$v4_digest"
      KEMERBET_RECHECK_BROWSER_FIREWALL_V6_DIGEST="$v6_digest"
      ;;
  esac
}

require_kemerbet_recheck_network_firewall() {
  local container_id="$1" role="$2" netns_fd expected_v4 expected_v6
  require_pinned_kemerbet_recheck_network_namespace "$container_id" "$role" || return 1
  case "$role" in
    controller)
      netns_fd="$KEMERBET_RECHECK_CONTROLLER_NETNS_FD"
      expected_v4="$KEMERBET_RECHECK_CONTROLLER_FIREWALL_V4_DIGEST"
      expected_v6="$KEMERBET_RECHECK_CONTROLLER_FIREWALL_V6_DIGEST"
      ;;
    browser)
      netns_fd="$KEMERBET_RECHECK_BROWSER_NETNS_FD"
      expected_v4="$KEMERBET_RECHECK_BROWSER_FIREWALL_V4_DIGEST"
      expected_v6="$KEMERBET_RECHECK_BROWSER_FIREWALL_V6_DIGEST"
      ;;
    *) return 1 ;;
  esac
  [[ "$expected_v4" =~ ^[0-9a-f]{64}$ && "$expected_v6" =~ ^[0-9a-f]{64}$ ]] || return 1
  [[ "$(normalized_kemerbet_recheck_firewall_digest "$netns_fd" 4)" == "$expected_v4" &&
    "$(normalized_kemerbet_recheck_firewall_digest "$netns_fd" 6)" == "$expected_v6" ]]
}

probe_kemerbet_recheck_denied_network() {
  local container_id="$1"
  docker_local container exec "$container_id" node -e '
const dns = require("node:dns");
const net = require("node:net");
const dgram = require("node:dgram");
const deniedTcp = (host, port) => new Promise((resolve, reject) => {
  const socket = net.connect({host, port});
  const timer = setTimeout(() => { socket.destroy(); resolve(); }, 400);
  const done = () => { clearTimeout(timer); socket.destroy(); resolve(); };
  socket.once("error", done);
  socket.once("connect", () => { clearTimeout(timer); socket.destroy(); reject(new Error()); });
});
const deniedUdp = (host) => new Promise((resolve, reject) => {
  const socket = dgram.createSocket("udp4");
  const timer = setTimeout(() => { socket.close(); resolve(); }, 400);
  socket.once("error", () => { clearTimeout(timer); socket.close(); resolve(); });
  socket.once("message", () => { clearTimeout(timer); socket.close(); reject(new Error()); });
  socket.send(Buffer.from([0,1,1,0,0,1,0,0,0,0,0,0,7,101,120,97,109,112,108,101,3,99,111,109,0,0,1,0,1]), 53, host);
});
const deniedResolve = () => new Promise((resolve, reject) => {
  const resolver = new dns.Resolver();
  resolver.setServers(["127.0.0.11"]);
  const timer = setTimeout(resolve, 600);
  resolver.resolve4("example.com", (error, addresses) => {
    clearTimeout(timer);
    if (error || !Array.isArray(addresses) || addresses.length === 0) resolve();
    else reject(new Error());
  });
});
Promise.all([
  deniedTcp("127.0.0.11", 53),
  deniedTcp("1.1.1.1", 443),
  deniedUdp("127.0.0.11"),
  deniedUdp("1.1.1.1"),
  deniedResolve(),
]).then(() => process.exit(0), () => process.exit(1));
' >/dev/null 2>&1
}

publish_kemerbet_recheck_firewall_release() {
  local role="$1" path
  case "$role" in
    controller) path="$KEMERBET_RECHECK_CONTROLLER_FIREWALL_RELEASE" ;;
    browser) path="$KEMERBET_RECHECK_BROWSER_FIREWALL_RELEASE" ;;
    *) return 1 ;;
  esac
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%u:%g:%a:%h:%s' "$path")" == '0:0:444:1:0' ]] || return 1
  chmod 0600 "$path" || return 1
  printf '%s\n' "$KEMERBET_RECHECK_FIREWALL_RELEASE_CONTENT" >"$path" || return 1
  sync -f "$path" || return 1
  chmod 0444 "$path" || return 1
  sync -f "$KEMERBET_RECHECK_RPC_ROOT" || return 1
  [[ ! -L "$path" && "$(stat --format='%u:%g:%a:%h' "$path")" == '0:0:444:1' &&
    "$(<"$path")" == "$KEMERBET_RECHECK_FIREWALL_RELEASE_CONTENT" ]]
}

wait_for_kemerbet_recheck_service_healthy() {
  local container_id="$1" deadline status
  [[ "$container_id" =~ ^[0-9a-f]{64}$ ]] || return 1
  deadline=$((SECONDS + KEMERBET_RECHECK_SERVICE_READY_TIMEOUT_SECONDS))
  while (( SECONDS < deadline )); do
    status="$(docker_local container inspect "$container_id" \
      --format '{{.Id}}|{{.State.Status}}|{{.State.Running}}|{{.State.Paused}}|{{.State.OOMKilled}}|{{.State.Error}}|{{.RestartCount}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')" ||
      return 1
    case "$status" in
      "$container_id|running|true|false|false||0|healthy") return 0 ;;
      "$container_id|running|true|false|false||0|starting") ;;
      *) return 1 ;;
    esac
    sleep 1
  done
  return 1
}
remove_project_runtime_best_effort() {
  local cleanup_status=0 containers='' networks='' remaining=''
  if ! containers="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")"; then
    cleanup_status=1
  elif [[ -n "$containers" ]]; then
    # Container identifiers returned by Docker contain only hexadecimal characters and newlines.
    docker_local container rm --force $containers >/dev/null || cleanup_status=1
  fi
  if ! networks="$(docker_local network ls --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")"; then
    cleanup_status=1
  elif [[ -n "$networks" ]]; then
    # Network identifiers returned by Docker contain only hexadecimal characters and newlines.
    docker_local network rm $networks >/dev/null || cleanup_status=1
  fi
  remove_kemerbet_recheck_profile_snapshot_volume || cleanup_status=1
  remove_kemerbet_recheck_rpc_capabilities || cleanup_status=1
  if ! remaining="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")"; then
    cleanup_status=1
  elif [[ -n "$remaining" ]]; then
    cleanup_status=1
  fi
  if ! remaining="$(docker_local network ls --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")"; then
    cleanup_status=1
  elif [[ -n "$remaining" ]]; then
    cleanup_status=1
  fi
  return "$cleanup_status"
}

remove_staging_runtime_secrets_best_effort() {
  local cleanup_status=0 residues secret_path
  local -a secret_paths=(
    "$SECRET_ROOT/owner-database-url"
    "$SECRET_ROOT/publishable-key"
    "$SECRET_ROOT/customer-web-database-url"
    "$SECRET_ROOT/customer-web-publishable-key"
    "$SECRET_ROOT/customer-web-rate-limit-hmac"
    "$SECRET_ROOT/beta-database-url"
    "$SECRET_ROOT/beta-transport-hmac"
    "$SECRET_ROOT/bot-transport-hmac"
    "$SECRET_ROOT/beta-payload-hmac"
    "$SECRET_ROOT/player-action-database-url"
    "$SECRET_ROOT/api-action-transport-hmac"
    "$SECRET_ROOT/api-action-payload-hmac"
    "$SECRET_ROOT/api-action-capability-hmac"
    "$SECRET_ROOT/api-action-semantic-hmac"
    "$SECRET_ROOT/cbe-deposit-reference-encryption-key"
    "$SECRET_ROOT/cbe-deposit-reference-fingerprint-key"
    "$SECRET_ROOT/cbe-deposit-reference-key-profile.v1.json"
    "$SECRET_ROOT/deposit-proof-reference-encryption-master"
    "$SECRET_ROOT/deposit-proof-reference-fingerprint-master"
    "$SECRET_ROOT/deposit-proof-reference-profile.v2.json"
    "$SECRET_ROOT/bot-action-transport-hmac"
    "$SECRET_ROOT/bot-token"
    "$SECRET_ROOT/supabase-ca.crt"
  )
  for secret_path in "${secret_paths[@]}"; do
    rm -f -- "$secret_path" || cleanup_status=1
  done
  purge_kemerbet_v1_reinstall_target_temps || cleanup_status=1
  remove_kemerbet_v1_reinstall_input_residues_best_effort || cleanup_status=1
  ( clear_bot_startup_receipt ) || cleanup_status=1
  for secret_path in "${secret_paths[@]}"; do
    [[ ! -e "$secret_path" && ! -L "$secret_path" ]] || cleanup_status=1
  done
  require_kemerbet_v1_reinstall_target_temps_absent || cleanup_status=1
  [[ ! -e "$BOT_STARTUP_RECEIPT" && ! -L "$BOT_STARTUP_RECEIPT" &&
    ! -e "$BOT_STARTUP_RECEIPT_ROOT" && ! -L "$BOT_STARTUP_RECEIPT_ROOT" ]] || cleanup_status=1
  if ! residues="$(list_kemerbet_v1_reinstall_input_residues)"; then
    cleanup_status=1
  elif [[ -n "$residues" ]]; then
    cleanup_status=1
  fi
  return "$cleanup_status"
}

stop_project_runtime_only() {
  remove_project_runtime_best_effort ||
    die 'the exact staging project runtime could not be removed completely'
}

stop_project() {
  stop_project_runtime_only
  remove_staging_runtime_secrets_best_effort ||
    die 'the disposable staging credentials or bot receipt could not be removed completely'
}

emergency_stop_project_after_kemerbet_recovery_failure() {
  local cleanup_status=0
  remove_project_runtime_best_effort || cleanup_status=1
  remove_staging_runtime_secrets_best_effort || cleanup_status=1
  return "$cleanup_status"
}

emergency_disarm_expiry_stop_after_kemerbet_recovery_failure() {
  local cleanup_status=0 timer_load_state=''
  if command -v systemctl >/dev/null 2>&1; then
    if timer_load_state="$(systemctl show --property=LoadState --value "$EXPIRY_STOP_TIMER" 2>/dev/null)"; then
      if [[ "$timer_load_state" != 'not-found' && -n "$timer_load_state" ]]; then
        systemctl disable --now "$EXPIRY_STOP_TIMER" >/dev/null || cleanup_status=1
      fi
    else
      cleanup_status=1
    fi
  else
    cleanup_status=1
  fi
  rm -f -- "$EXPIRY_STOP_TIMER_PATH" "$EXPIRY_STOP_SERVICE_PATH" || cleanup_status=1
  if command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload || cleanup_status=1
    if timer_load_state="$(systemctl show --property=LoadState --value "$EXPIRY_STOP_TIMER" 2>/dev/null)"; then
      [[ "$timer_load_state" == 'not-found' ]] || cleanup_status=1
    else
      cleanup_status=1
    fi
  fi
  return "$cleanup_status"
}

disarm_expiry_stop() {
  local timer_load_state

  command -v systemctl >/dev/null 2>&1 || die 'systemctl is unavailable'
  timer_load_state="$(systemctl show --property=LoadState --value "$EXPIRY_STOP_TIMER" 2>/dev/null || true)"
  if [[ "$timer_load_state" != 'not-found' && -n "$timer_load_state" ]]; then
    systemctl disable --now "$EXPIRY_STOP_TIMER" >/dev/null ||
      die 'the staging runtime expiry-stop timer could not be disabled'
  fi
  rm -f -- "$EXPIRY_STOP_TIMER_PATH" "$EXPIRY_STOP_SERVICE_PATH"
  systemctl daemon-reload || die 'systemd could not reload after removing the expiry-stop timer'
  [[ "$(systemctl show --property=LoadState --value "$EXPIRY_STOP_TIMER" 2>/dev/null || true)" == 'not-found' ]] ||
    die 'the staging runtime expiry-stop timer remains loaded'
}

arm_expiry_stop() (
  local calendar_stop_at commit_sha compose_file now_epoch stop_at stop_epoch temp_dir

  commit_sha="$1"
  stop_at="$2"
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
    die 'arm-expiry-stop requires a reviewed 40-character commit'
  [[ "$stop_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ||
    die 'arm-expiry-stop requires one canonical UTC stop time'
  stop_epoch="$(date -u -d "$stop_at" +%s)" || die 'the expiry-stop time is invalid'
  [[ "$(date -u -d "@$stop_epoch" '+%Y-%m-%dT%H:%M:%SZ')" == "$stop_at" ]] ||
    die 'the expiry-stop time is not canonical UTC'
  now_epoch="$(date -u +%s)"
  (( stop_epoch > now_epoch + 21 * 60 * 60 )) ||
    die 'the expiry-stop time does not retain the required lower safety bound'
  (( stop_epoch <= now_epoch + 23 * 60 * 60 )) ||
    die 'the expiry-stop time exceeds the required upper safety bound'

  compose_file="$RELEASE_ROOT/$commit_sha/infra/compose.staging-beta.yaml"
  [[ ! -L "$compose_file" && "$(stat --format='%U:%G:%a' "$compose_file")" == 'root:root:444' ]] ||
    die 'the sealed Compose contract is absent or unsafe before arming expiry-stop'

  command -v systemctl >/dev/null 2>&1 || die 'systemctl is unavailable'
  command -v mktemp >/dev/null 2>&1 || die 'mktemp is unavailable'
  temp_dir="$(mktemp -d /run/fetanagent-expiry-stop.XXXXXX)" ||
    die 'the expiry-stop unit staging directory could not be created'
  trap 'rm -rf -- "$temp_dir"' EXIT
  calendar_stop_at="${stop_at/T/ }"
  calendar_stop_at="${calendar_stop_at/Z/ UTC}"

  cat >"$temp_dir/$EXPIRY_STOP_SERVICE" <<EOF
[Unit]
Description=Stop FetanAgent staging before disposable database credentials expire
StartLimitIntervalSec=0

[Service]
Type=oneshot
Environment=FETANAGENT_STAGING_EXPIRY_GUARD=1
ExecStart=$HELPER_PATH expiry-stop
Restart=on-failure
RestartSec=60
NoNewPrivileges=true
PrivateTmp=true
UMask=0077
EOF
  cat >"$temp_dir/$EXPIRY_STOP_TIMER" <<EOF
[Unit]
Description=FetanAgent staging disposable-credential expiry guard

[Timer]
OnCalendar=$calendar_stop_at
AccuracySec=1min
Persistent=true
Unit=$EXPIRY_STOP_SERVICE

[Install]
WantedBy=timers.target
EOF

  disarm_expiry_stop
  install -o root -g root -m 0644 \
    "$temp_dir/$EXPIRY_STOP_SERVICE" "$EXPIRY_STOP_SERVICE_PATH"
  install -o root -g root -m 0644 \
    "$temp_dir/$EXPIRY_STOP_TIMER" "$EXPIRY_STOP_TIMER_PATH"
  systemctl daemon-reload || die 'systemd could not load the expiry-stop units'
  systemctl enable --now "$EXPIRY_STOP_TIMER" >/dev/null ||
    die 'the staging runtime expiry-stop timer could not be enabled'
  systemctl is-enabled --quiet "$EXPIRY_STOP_TIMER" ||
    die 'the staging runtime expiry-stop timer is not enabled'
  systemctl is-active --quiet "$EXPIRY_STOP_TIMER" ||
    die 'the staging runtime expiry-stop timer is not active'
  [[ "$(stat --format='%U:%G:%a' "$EXPIRY_STOP_SERVICE_PATH")" == 'root:root:644' ]] ||
    die 'the expiry-stop service ownership or mode is unsafe'
  [[ "$(stat --format='%U:%G:%a' "$EXPIRY_STOP_TIMER_PATH")" == 'root:root:644' ]] ||
    die 'the expiry-stop timer ownership or mode is unsafe'
)

require_cutover_ready() {
  local legacy_containers legacy_networks legacy_secret_residue
  local systemd_units systemd_unit_files

  command -v docker >/dev/null 2>&1 || die 'Docker is unavailable'
  command -v systemctl >/dev/null 2>&1 || die 'systemctl is unavailable'
  command -v find >/dev/null 2>&1 || die 'the find utility is unavailable'
  command -v grep >/dev/null 2>&1 || die 'the grep utility is unavailable'

  if ! legacy_containers="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$LEGACY_PROJECT_NAME")"; then
    die 'the legacy container inventory could not be inspected'
  fi
  [[ -z "$legacy_containers" ]] || die 'legacy project containers remain'

  if ! legacy_networks="$(docker_local network ls --quiet \
    --filter "label=com.docker.compose.project=$LEGACY_PROJECT_NAME")"; then
    die 'the legacy network inventory could not be inspected'
  fi
  [[ -z "$legacy_networks" ]] || die 'legacy project networks remain'

  if ! systemd_units="$(systemctl list-units --all --full --plain --no-legend --no-pager)"; then
    die 'the loaded systemd unit inventory could not be inspected'
  fi
  if grep -Fiq -- "$LEGACY_SYSTEMD_MARKER" <<<"$systemd_units"; then
    die 'a legacy systemd unit remains loaded'
  fi

  if ! systemd_unit_files="$(systemctl list-unit-files --full --no-legend --no-pager)"; then
    die 'the installed systemd unit inventory could not be inspected'
  fi
  if grep -Fiq -- "$LEGACY_SYSTEMD_MARKER" <<<"$systemd_unit_files"; then
    die 'a legacy systemd unit file remains installed'
  fi

  if [[ -L "$LEGACY_SECRET_ROOT" ]]; then
    die 'the legacy secret root remains as a symbolic link'
  fi
  if [[ -e "$LEGACY_SECRET_ROOT" ]]; then
    [[ -d "$LEGACY_SECRET_ROOT" ]] || die 'the legacy secret root is not a directory'
    if ! legacy_secret_residue="$(find "$LEGACY_SECRET_ROOT" -mindepth 1 -print -quit)"; then
      die 'the legacy secret root could not be inspected'
    fi
    [[ -z "$legacy_secret_residue" ]] || die 'legacy secret files remain'
  fi
}

require_port_3002_free() {
  local socket_inventory
  command -v awk >/dev/null 2>&1 || die 'the awk utility is unavailable'
  command -v ss >/dev/null 2>&1 || die 'the ss utility is unavailable'
  if ! socket_inventory="$(ss -ltnH)"; then
    die 'the TCP listener inventory could not be inspected'
  fi
  if awk '$4 ~ /:3002$/ { found = 1 } END { exit !found }' <<<"$socket_inventory"; then
    die 'TCP port 3002 is already in use'
  fi
}

require_reviewed_owner_port_3002() {
  local commit_sha="$1"
  local exact_listener_count owner_binding owner_container port_listener_count socket_inventory

  command -v awk >/dev/null 2>&1 || die 'the awk utility is unavailable'
  command -v docker >/dev/null 2>&1 || die 'Docker is unavailable'
  command -v ss >/dev/null 2>&1 || die 'the ss utility is unavailable'

  owner_container="$(docker_local container ls --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter 'label=com.docker.compose.service=owner-control' \
    --filter 'health=healthy')"
  [[ "$owner_container" =~ ^[0-9a-f]{12,64}$ ]] ||
    die 'the reviewed Owner-control container is not healthy'
  [[ "$(docker_local image inspect \
    "$(docker_local container inspect "$owner_container" --format '{{.Image}}')" \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$commit_sha" ]] ||
    die 'the reviewed Owner-control image does not match the requested commit'
  if ! owner_binding="$(docker_local container port "$owner_container" '3002/tcp')"; then
    die 'the reviewed Owner-control port binding could not be inspected'
  fi
  [[ "$owner_binding" == '127.0.0.1:3002' ]] ||
    die 'the reviewed Owner-control port binding is not exact'

  if ! socket_inventory="$(ss -ltnH)"; then
    die 'the TCP listener inventory could not be inspected'
  fi
  port_listener_count="$(awk '$4 ~ /:3002$/ { count += 1 } END { print count + 0 }' \
    <<<"$socket_inventory")"
  exact_listener_count="$(awk '$4 == "127.0.0.1:3002" { count += 1 } END { print count + 0 }' \
    <<<"$socket_inventory")"
  [[ "$port_listener_count" == '1' && "$exact_listener_count" == '1' ]] ||
    die 'TCP port 3002 has an unexpected or ambiguous listener'
}

require_exact_current_component_container() {
  local container_id="$1"
  local service="$2"
  local commit_sha="$3"
  local container_revision image_id image_revision observed_project observed_service

  [[ "$container_id" =~ ^[0-9a-f]{12,64}$ ]] ||
    die 'the component container identity is malformed'
  [[ "$service" =~ ^(bot|gateway|kemerbet-session-provision)$ ]] ||
    die 'the component service identity is invalid'
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
    die 'the component release identity is invalid'

  observed_project="$(docker_local container inspect "$container_id" \
    --format '{{ index .Config.Labels "com.docker.compose.project" }}')" ||
    die 'the component container project could not be inspected'
  [[ "$observed_project" == "$PROJECT_NAME" ]] ||
    die 'the component container belongs to an unexpected project'
  observed_service="$(docker_local container inspect "$container_id" \
    --format '{{ index .Config.Labels "com.docker.compose.service" }}')" ||
    die 'the component container service could not be inspected'
  [[ "$observed_service" == "$service" ]] ||
    die 'the component container service is not exact'
  container_revision="$(docker_local container inspect "$container_id" \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" ||
    die 'the component container revision could not be inspected'
  [[ "$container_revision" == "$commit_sha" ]] ||
    die 'the component container does not run the reviewed commit'
  image_id="$(docker_local container inspect "$container_id" --format '{{.Image}}')" ||
    die 'the component container image identity could not be inspected'
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] ||
    die 'the component container image identity is malformed'
  image_revision="$(docker_local image inspect "$image_id" \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" ||
    die 'the component container image revision could not be inspected'
  [[ "$image_revision" == "$commit_sha" ]] ||
    die 'the component container image does not match the reviewed commit'
}

require_exact_private_runtime() {
  local commit_sha="$1"
  local container_id health ids revision service services state
  local -a expected_services=(api beta-admission bot customer-web owner-control)

  services="$({
    docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" |
      while IFS= read -r container_id; do
        [[ -n "$container_id" ]] || continue
        docker_local container inspect "$container_id" \
          --format '{{ index .Config.Labels "com.docker.compose.service" }}'
      done
  } | sort)" || die 'the private FetanAgent service inventory could not be inspected'
  [[ "$services" == $'api\nbeta-admission\nbot\ncustomer-web\nowner-control' ]] ||
    die 'the private FetanAgent service set is not exact'

  for service in "${expected_services[@]}"; do
    ids="$(docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter "label=com.docker.compose.service=$service")" ||
      die "the $service container inventory could not be inspected"
    [[ "$ids" =~ ^[0-9a-f]{12,64}$ ]] || die "the $service container inventory is not singular"
    state="$(docker_local container inspect "$ids" --format '{{.State.Status}}')"
    [[ "$state" == 'running' ]] || die "$service is not running"
    revision="$(docker_local container inspect "$ids" \
      --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
    [[ "$revision" == "$commit_sha" ]] || die "$service does not run the reviewed commit"
    if [[ "$service" != 'bot' ]]; then
      health="$(docker_local container inspect "$ids" --format '{{.State.Health.Status}}')"
      [[ "$health" == 'healthy' ]] || die "$service is not healthy"
    fi
  done

  require_reviewed_owner_port_3002 "$commit_sha"
}

require_live_api_runtime_contract() {
  local container_id="$1"
  local runtime_contract

  [[ "$container_id" =~ ^[0-9a-f]{12,64}$ ]] ||
    die 'the live API runtime-contract container identity is malformed'
  runtime_contract="$(docker_local container exec "$container_id" \
    node --input-type=module --eval '
      try {
        const response = await fetch("http://127.0.0.1:3000/healthz", {
          redirect: "error",
          signal: AbortSignal.timeout(3000),
        });
        const contentType = response.headers.get("content-type");
        if (response.status !== 200 || !contentType?.startsWith("application/json")) {
          process.exit(22);
        }
        const health = await response.json();
        const runtimeContract = health.runtimeContract;
        if (
          health.status !== "ok" ||
          health.service !== "fetanagent-api" ||
          runtimeContract.financialActionsMode !== "dry_run" ||
          runtimeContract.playerActionRuntimeEnabled !== true ||
          runtimeContract.depositProofReferenceMastersConfigured !== true ||
          runtimeContract.depositProofReferenceProfileVersion !== 2
        ) {
          process.exit(23);
        }
        process.stdout.write(JSON.stringify(runtimeContract));
      } catch {
        process.exit(24);
      }
    ')" || die 'the live API runtime contract could not be evaluated'
  [[ "$runtime_contract" == \
    '{"financialActionsMode":"dry_run","playerActionRuntimeEnabled":true,"depositProofReferenceMastersConfigured":true,"depositProofReferenceProfileVersion":2}' ]] ||
    die 'the live API runtime contract is not the exact reviewed dry-run profile'
}

record_fresh_bot_startup_receipt() {
  local commit_sha="$1"
  local container_id container_started_at full_container_id restart_count revision temporary

  container_id="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter 'label=com.docker.compose.service=bot')" ||
    die 'the Telegram startup-receipt container inventory could not be inspected'
  [[ "$container_id" =~ ^[0-9a-f]{12,64}$ ]] ||
    die 'the Telegram startup-receipt container inventory is not singular'
  full_container_id="$(docker_local container inspect "$container_id" --format '{{.Id}}')" ||
    die 'the Telegram startup-receipt container identity could not be inspected'
  [[ "$full_container_id" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the Telegram startup-receipt container identity is malformed'
  container_started_at="$(docker_local container inspect "$container_id" --format '{{.State.StartedAt}}')" ||
    die 'the Telegram startup-receipt start time could not be inspected'
  [[ "$container_started_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$ ]] ||
    die 'the Telegram startup-receipt start time is not canonical UTC'
  revision="$(docker_local container inspect "$container_id" \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" ||
    die 'the Telegram startup-receipt revision could not be inspected'
  [[ "$revision" == "$commit_sha" ]] ||
    die 'the Telegram startup-receipt container does not run the reviewed commit'
  [[ "$(docker_local container inspect "$container_id" --format '{{.State.Status}}')" == 'running' ]] ||
    die 'the Telegram startup-receipt container is not running'
  restart_count="$(docker_local container inspect "$container_id" --format '{{.RestartCount}}')" ||
    die 'the Telegram startup-receipt restart count could not be inspected'
  [[ "$restart_count" == '0' ]] ||
    die 'the Telegram startup-receipt container restarted unexpectedly'
  docker_local container logs --tail 80 "$container_id" 2>&1 |
    grep -Fq 'Telegram bot started with configured private admission and action handlers.' ||
    die 'the Telegram startup-receipt container did not report its genuine startup contract'

  [[ ! -e "$BOT_STARTUP_RECEIPT_ROOT" && ! -L "$BOT_STARTUP_RECEIPT_ROOT" ]] ||
    die 'a Telegram startup receipt already exists before immediate attestation'
  install -d -o root -g root -m 0700 "$BOT_STARTUP_RECEIPT_ROOT"
  temporary="$(mktemp "$BOT_STARTUP_RECEIPT_ROOT/.bot-v1.XXXXXX")" ||
    die 'the Telegram startup-receipt temporary file could not be created'
  if ! printf '%s\n' \
      "receipt_version=$BOT_STARTUP_RECEIPT_VERSION" \
      "commit_sha=$commit_sha" \
      "container_id=$full_container_id" \
      "container_started_at=$container_started_at" \
      'restart_count=0' \
      'startup_contract=telegram-private-admission-actions-v1' >"$temporary" ||
    ! chown root:root "$temporary" ||
    ! chmod 0600 "$temporary" ||
    ! mv -fT -- "$temporary" "$BOT_STARTUP_RECEIPT"; then
    rm -f -- "$temporary"
    die 'the Telegram startup receipt could not be sealed atomically'
  fi
}

require_fresh_bot_startup_receipt() {
  local commit_sha="$1"
  local container_id="$2"
  local container_started_at full_container_id restart_count

  command -v cmp >/dev/null 2>&1 || die 'cmp is unavailable for Telegram startup receipt'
  [[ ! -L "$BOT_STARTUP_RECEIPT_ROOT" && -d "$BOT_STARTUP_RECEIPT_ROOT" ]] ||
    die 'the Telegram startup-receipt root is absent or unsafe'
  [[ "$(stat --format='%U:%G:%a' "$BOT_STARTUP_RECEIPT_ROOT")" == 'root:root:700' ]] ||
    die 'the Telegram startup-receipt root ownership or mode is unsafe'
  [[ ! -L "$BOT_STARTUP_RECEIPT" && -f "$BOT_STARTUP_RECEIPT" ]] ||
    die 'the Telegram startup receipt is absent or unsafe'
  [[ "$(stat --format='%U:%G:%a' "$BOT_STARTUP_RECEIPT")" == 'root:root:600' ]] ||
    die 'the Telegram startup receipt ownership or mode is unsafe'
  full_container_id="$(docker_local container inspect "$container_id" --format '{{.Id}}')" ||
    die 'the receipted Telegram container identity could not be inspected'
  [[ "$full_container_id" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the receipted Telegram container identity is malformed'
  container_started_at="$(docker_local container inspect "$container_id" --format '{{.State.StartedAt}}')" ||
    die 'the receipted Telegram start time could not be inspected'
  restart_count="$(docker_local container inspect "$container_id" --format '{{.RestartCount}}')" ||
    die 'the receipted Telegram restart count could not be inspected'
  [[ "$restart_count" == '0' ]] || die 'the receipted Telegram bot restarted unexpectedly'
  cmp -s -- "$BOT_STARTUP_RECEIPT" <(printf '%s\n' \
    "receipt_version=$BOT_STARTUP_RECEIPT_VERSION" \
    "commit_sha=$commit_sha" \
    "container_id=$full_container_id" \
    "container_started_at=$container_started_at" \
    'restart_count=0' \
    'startup_contract=telegram-private-admission-actions-v1') ||
    die 'the Telegram startup receipt does not match this exact running container'
}

require_exact_fresh_private_runtime() {
  local commit_sha="$1"
  local container_id environment forbidden_environment health ids revision service services state
  local expected_environment
  local -a expected_services=(api beta-admission customer-web owner-control)

  services="$({
    docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" |
      while IFS= read -r container_id; do
        [[ -n "$container_id" ]] || continue
        docker_local container inspect "$container_id" \
          --format '{{ index .Config.Labels "com.docker.compose.service" }}'
      done
  } | sort)" || die 'the fresh-host private FetanAgent service inventory could not be inspected'
  [[ "$services" == $'api\nbeta-admission\ncustomer-web\nowner-control' ]] ||
    die 'the fresh-host private FetanAgent service set is not exact'

  for service in "${expected_services[@]}"; do
    ids="$(docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter "label=com.docker.compose.service=$service")" ||
      die "the fresh-host $service container inventory could not be inspected"
    [[ "$ids" =~ ^[0-9a-f]{12,64}$ ]] ||
      die "the fresh-host $service container inventory is not singular"
    state="$(docker_local container inspect "$ids" --format '{{.State.Status}}')"
    [[ "$state" == 'running' ]] || die "the fresh-host $service service is not running"
    health="$(docker_local container inspect "$ids" --format '{{.State.Health.Status}}')"
    [[ "$health" == 'healthy' ]] || die "the fresh-host $service service is not healthy"
    revision="$(docker_local container inspect "$ids" \
      --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
    [[ "$revision" == "$commit_sha" ]] ||
      die "the fresh-host $service service does not run the reviewed commit"

    environment="$(docker_local container inspect "$ids" \
      --format '{{range .Config.Env}}{{println .}}{{end}}')" ||
      die "the fresh-host $service environment could not be inspected"
    for expected_environment in \
      'NODE_ENV=production' \
      'FINANCIAL_ACTIONS_MODE=dry_run' \
      'TELEGRAM_BOT_ENABLED=false' \
      'TELEGRAM_BETA_ADMISSION_ENABLED=false' \
      'KEMERBET_EXECUTOR_ENABLED=false' \
      'KEMERBET_FINAL_ACTION_ENABLED=false'; do
      grep -Fxq "$expected_environment" <<<"$environment" ||
        die "the fresh-host $service safety environment is not exact"
    done
    if [[ "$service" == 'customer-web' ]]; then
      for expected_environment in \
        'INTERNAL_CUSTOMER_WEB_AUTH_RUNTIME_ENABLED=true' \
        'INTERNAL_CUSTOMER_WEB_WORKSPACE_RUNTIME_ENABLED=true' \
        'INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED=false' \
        'INTERNAL_CUSTOMER_WEB_DRY_RUN_DEPOSIT_PROOF_RUNTIME_ENABLED=true' \
        'DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET_FILE=/run/secrets/deposit_proof_reference_encryption_master' \
        'DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET_FILE=/run/secrets/deposit_proof_reference_fingerprint_master' \
        'DEPOSIT_PROOF_REFERENCE_PROFILE_FILE=/etc/fetanagent/deposit-proof-reference-profile.v2.json' \
        'INTERNAL_CUSTOMER_WEB_DURABLE_RATE_LIMIT_ENABLED=true'; do
        grep -Fxq "$expected_environment" <<<"$environment" ||
          die 'the fresh-host customer-web capability environment is not exact'
      done
    fi
    if [[ "$service" == 'api' ]]; then
      for expected_environment in \
        'DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET_FILE=/run/secrets/deposit_proof_reference_encryption_master' \
        'DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET_FILE=/run/secrets/deposit_proof_reference_fingerprint_master' \
        'DEPOSIT_PROOF_REFERENCE_PROFILE_FILE=/etc/fetanagent/deposit-proof-reference-profile.v2.json'; do
        grep -Fxq "$expected_environment" <<<"$environment" ||
          die 'the fresh-host API provider-proof v2 environment is not exact'
      done
      require_live_api_runtime_contract "$ids"
    fi
    if [[ "$service" == 'api' || "$service" == 'customer-web' ]]; then
      for forbidden_environment in \
        DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET \
        DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET \
        DEPOSIT_PROOF_REFERENCE_PROFILE; do
        ! grep -Eq "^${forbidden_environment}=" <<<"$environment" ||
          die "the fresh-host $service provider-proof v2 material is exposed inline"
      done
    else
      ! grep -Eq '^(DEPOSIT_PROOF_REFERENCE_|INTERNAL_CUSTOMER_WEB_DRY_RUN_DEPOSIT_PROOF_RUNTIME_ENABLED=)' \
        <<<"$environment" ||
        die "the fresh-host $service unexpectedly receives the provider-proof v2 contract"
    fi
  done

  require_reviewed_owner_port_3002 "$commit_sha"
}

require_exact_fresh_bot_runtime() {
  local commit_sha="$1"
  local startup_contract_mode="$2"
  local container_id environment forbidden_environment health ids restart_count revision service services state
  local expected_environment
  local gateway_container gateway_health gateway_restart gateway_revision services_contract
  local -a expected_services=(api beta-admission bot customer-web owner-control)

  [[ "$startup_contract_mode" == 'immediate-startup' || "$startup_contract_mode" == 'steady-state' ||
    "$startup_contract_mode" == 'published-steady-state' ||
    "$startup_contract_mode" == 'published-with-kemerbet-session' ]] ||
    die 'the fresh-host Telegram startup-contract mode is invalid'

  if [[ "$startup_contract_mode" == 'published-with-kemerbet-session' ]]; then
    services_contract=$'api\nbeta-admission\nbot\ncustomer-web\ngateway\nkemerbet-session-provision\nowner-control'
  elif [[ "$startup_contract_mode" == 'published-steady-state' ]]; then
    services_contract=$'api\nbeta-admission\nbot\ncustomer-web\ngateway\nowner-control'
  else
    services_contract=$'api\nbeta-admission\nbot\ncustomer-web\nowner-control'
  fi

  services="$({
    docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" |
      while IFS= read -r container_id; do
        [[ -n "$container_id" ]] || continue
        docker_local container inspect "$container_id" \
          --format '{{ index .Config.Labels "com.docker.compose.service" }}'
      done
  } | sort)" || die 'the fresh-host Telegram service inventory could not be inspected'
  [[ "$services" == "$services_contract" ]] ||
    die 'the fresh-host Telegram service set is not exact'

  for service in "${expected_services[@]}"; do
    ids="$(docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter "label=com.docker.compose.service=$service")" ||
      die "the fresh-host $service container inventory could not be inspected"
    [[ "$ids" =~ ^[0-9a-f]{12,64}$ ]] ||
      die "the fresh-host $service container inventory is not singular"
    state="$(docker_local container inspect "$ids" --format '{{.State.Status}}')"
    [[ "$state" == 'running' ]] || die "the fresh-host $service service is not running"
    revision="$(docker_local container inspect "$ids" \
      --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
    [[ "$revision" == "$commit_sha" ]] ||
      die "the fresh-host $service service does not run the reviewed commit"

    environment="$(docker_local container inspect "$ids" \
      --format '{{range .Config.Env}}{{println .}}{{end}}')" ||
      die "the fresh-host $service environment could not be inspected"
    for expected_environment in \
      'NODE_ENV=production' \
      'FINANCIAL_ACTIONS_MODE=dry_run' \
      'KEMERBET_EXECUTOR_ENABLED=false' \
      'KEMERBET_FINAL_ACTION_ENABLED=false'; do
      grep -Fxq "$expected_environment" <<<"$environment" ||
        die "the fresh-host $service safety environment is not exact"
    done

    if [[ "$service" == 'customer-web' ]]; then
      for expected_environment in \
        'INTERNAL_CUSTOMER_WEB_AUTH_RUNTIME_ENABLED=true' \
        'INTERNAL_CUSTOMER_WEB_WORKSPACE_RUNTIME_ENABLED=true' \
        'INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED=false' \
        'INTERNAL_CUSTOMER_WEB_DRY_RUN_DEPOSIT_PROOF_RUNTIME_ENABLED=true' \
        'DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET_FILE=/run/secrets/deposit_proof_reference_encryption_master' \
        'DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET_FILE=/run/secrets/deposit_proof_reference_fingerprint_master' \
        'DEPOSIT_PROOF_REFERENCE_PROFILE_FILE=/etc/fetanagent/deposit-proof-reference-profile.v2.json' \
        'INTERNAL_CUSTOMER_WEB_DURABLE_RATE_LIMIT_ENABLED=true'; do
        grep -Fxq "$expected_environment" <<<"$environment" ||
          die 'the fresh-host customer-web capability environment is not exact'
      done
    fi

    if [[ "$service" == 'api' ]]; then
      for expected_environment in \
        'DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET_FILE=/run/secrets/deposit_proof_reference_encryption_master' \
        'DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET_FILE=/run/secrets/deposit_proof_reference_fingerprint_master' \
        'DEPOSIT_PROOF_REFERENCE_PROFILE_FILE=/etc/fetanagent/deposit-proof-reference-profile.v2.json'; do
        grep -Fxq "$expected_environment" <<<"$environment" ||
          die 'the fresh-host API provider-proof v2 environment is not exact'
      done
      require_live_api_runtime_contract "$ids"
    fi
    if [[ "$service" == 'api' || "$service" == 'customer-web' ]]; then
      for forbidden_environment in \
        DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET \
        DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET \
        DEPOSIT_PROOF_REFERENCE_PROFILE; do
        ! grep -Eq "^${forbidden_environment}=" <<<"$environment" ||
          die "the fresh-host $service provider-proof v2 material is exposed inline"
      done
    else
      ! grep -Eq '^(DEPOSIT_PROOF_REFERENCE_|INTERNAL_CUSTOMER_WEB_DRY_RUN_DEPOSIT_PROOF_RUNTIME_ENABLED=)' \
        <<<"$environment" ||
        die "the fresh-host $service unexpectedly receives the provider-proof v2 contract"
    fi

    if [[ "$service" == 'bot' ]]; then
      for expected_environment in \
        'TELEGRAM_BOT_ENABLED=true' \
        'TELEGRAM_BETA_ADMISSION_ENABLED=true'; do
        grep -Fxq "$expected_environment" <<<"$environment" ||
          die 'the fresh-host Telegram bot activation environment is not exact'
      done
      restart_count="$(docker_local container inspect "$ids" --format '{{.RestartCount}}')"
      [[ "$restart_count" == '0' ]] || die 'the fresh-host Telegram bot restarted unexpectedly'
      if [[ "$startup_contract_mode" == 'immediate-startup' ]]; then
        docker_local container logs --tail 80 "$ids" 2>&1 |
          grep -Fq 'Telegram bot started with configured private admission and action handlers.' ||
          die 'the fresh-host Telegram bot did not report its genuine startup contract'
      else
        require_fresh_bot_startup_receipt "$commit_sha" "$ids"
      fi
    else
      health="$(docker_local container inspect "$ids" --format '{{.State.Health.Status}}')"
      [[ "$health" == 'healthy' ]] || die "the fresh-host $service service is not healthy"
      for expected_environment in \
        'TELEGRAM_BOT_ENABLED=false' \
        'TELEGRAM_BETA_ADMISSION_ENABLED=false'; do
        grep -Fxq "$expected_environment" <<<"$environment" ||
          die "the fresh-host $service Telegram safety environment is not exact"
      done
    fi
  done

  if [[ "$startup_contract_mode" == 'published-steady-state' ||
    "$startup_contract_mode" == 'published-with-kemerbet-session' ]]; then
    gateway_container="$(docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter 'label=com.docker.compose.service=gateway')" ||
      die 'the published gateway inventory could not be inspected'
    [[ "$gateway_container" =~ ^[0-9a-f]{12,64}$ ]] ||
      die 'the published gateway inventory is not singular'
    [[ "$(docker_local container inspect "$gateway_container" --format '{{.State.Status}}')" == 'running' ]] ||
      die 'the published gateway is not running'
    gateway_health="$(docker_local container inspect "$gateway_container" --format '{{.State.Health.Status}}')"
    [[ "$gateway_health" == 'healthy' ]] || die 'the published gateway is not healthy'
    gateway_revision="$(docker_local container inspect "$gateway_container" \
      --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
    [[ "$gateway_revision" == "$commit_sha" ]] ||
      die 'the published gateway does not run the reviewed commit'
    gateway_restart="$(docker_local container inspect "$gateway_container" --format '{{.RestartCount}}')"
    [[ "$gateway_restart" == '0' ]] || die 'the published gateway restarted unexpectedly'
  fi

  require_reviewed_owner_port_3002 "$commit_sha"
}

require_kemerbet_session_provision_runtime() {
  local commit_sha="$1"
  local binding_source container_id environment health mount_contract owner_container owner_socket_source
  local identity_key_source profile_volume_source readiness_output_source revision selector_source
  local session_socket_source

  require_kemerbet_identity_key_file "$KEMERBET_AGENT_IDENTITY_HMAC_KEY"
  require_root_readable_immutable_file "$KEMERBET_AGENT_IDENTITY_BINDINGS"
  require_kemerbet_v3_binding_content "$KEMERBET_AGENT_IDENTITY_BINDINGS" ||
    die 'the private KemerBet session identity binding is not an exact immutable v3 binding'
  require_immutable_config_file "$KEMERBET_SELECTOR_CONTRACT"
  require_kemerbet_readiness_output_directory

  container_id="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter 'label=com.docker.compose.service=kemerbet-session-provision')" ||
    die 'the private KemerBet session container inventory could not be inspected'
  [[ "$container_id" =~ ^[0-9a-f]{12,64}$ ]] ||
    die 'the private KemerBet session container inventory is not singular'
  [[ "$(docker_local container inspect "$container_id" --format '{{.State.Status}}')" == 'running' ]] ||
    die 'the private KemerBet session container is not running'
  health="$(docker_local container inspect "$container_id" --format '{{.State.Health.Status}}')"
  [[ "$health" == 'healthy' ]] || die 'the private KemerBet session container is not healthy'
  revision="$(docker_local container inspect "$container_id" \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
  [[ "$revision" == "$commit_sha" ]] ||
    die 'the private KemerBet session container does not run the reviewed commit'
  [[ "$(docker_local container inspect "$container_id" --format '{{.Config.User}}')" == '10001:10001' ]] ||
    die 'the private KemerBet session container user is not exact'
  [[ "$(docker_local container inspect "$container_id" --format '{{json .Config.Cmd}}')" == \
    '["node","apps/executor/dist/kemerbet-session-provision-server.js"]' ]] ||
    die 'the private KemerBet session container command is not exact'
  [[ "$(docker_local container inspect "$container_id" --format '{{.HostConfig.ReadonlyRootfs}}')" == 'true' ]] ||
    die 'the private KemerBet session root filesystem is writable'
  [[ "$(docker_local container inspect "$container_id" --format '{{.RestartCount}}')" == '0' ]] ||
    die 'the private KemerBet session container restarted unexpectedly'
  [[ "$(docker_local container inspect "$container_id" --format '{{json .HostConfig.CapAdd}}')" == 'null' ]] ||
    die 'the private KemerBet session container adds a Linux capability'
  [[ "$(docker_local container inspect "$container_id" --format '{{json .HostConfig.CapDrop}}')" == '["ALL"]' ]] ||
    die 'the private KemerBet session container does not drop every Linux capability'
  [[ "$(docker_local container inspect "$container_id" --format '{{json .HostConfig.SecurityOpt}}')" == '["no-new-privileges:true"]' ]] ||
    die 'the private KemerBet session container permits privilege escalation'
  [[ "$(docker_local container inspect "$container_id" --format '{{.HostConfig.PidsLimit}}')" == '512' ]] ||
    die 'the private KemerBet session PID limit is not exact'
  [[ "$(docker_local container inspect "$container_id" --format '{{.HostConfig.Memory}}')" == '1610612736' ]] ||
    die 'the private KemerBet session memory limit is not exact'
  [[ "$(docker_local container inspect "$container_id" --format '{{.HostConfig.NanoCpus}}')" == '2000000000' ]] ||
    die 'the private KemerBet session CPU limit is not exact'
  [[ "$(docker_local container inspect "$container_id" --format '{{.HostConfig.ShmSize}}')" == '536870912' ]] ||
    die 'the private KemerBet session shared-memory limit is not exact'
  [[ "$(docker_local container inspect "$container_id" --format '{{json .HostConfig.PortBindings}}')" == '{}' ]] ||
    die 'the private KemerBet session container publishes a port'

  environment="$(docker_local container inspect "$container_id" \
    --format '{{range .Config.Env}}{{println .}}{{end}}')" ||
    die 'the private KemerBet session environment could not be inspected'
  for expected_environment in \
    'NODE_ENV=production' \
    'FINANCIAL_ACTIONS_MODE=dry_run' \
    'KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED=true' \
    'KEMERBET_EXECUTOR_ENABLED=false' \
    'KEMERBET_FINAL_ACTION_ENABLED=false' \
    'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=false' \
    'INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED=false'; do
    grep -Fxq "$expected_environment" <<<"$environment" ||
      die 'the private KemerBet session safety environment is not exact'
  done
  ! grep -Eq '(DATABASE|PASSWORD|SECRET|TOKEN|HMAC|SUPABASE|PLAYER|RECEIVER|SELECTOR|IDENTITY)' \
    <<<"$environment" || die 'the private KemerBet session environment contains forbidden authority'

  mount_contract="$(docker_local container inspect "$container_id" \
    --format '{{range .Mounts}}{{printf "%s|%s|%t\n" .Type .Destination .RW}}{{end}}')" ||
    die 'the private KemerBet session mount contract could not be inspected'
  [[ "$(grep -c '^' <<<"$mount_contract")" == '6' ]] ||
    die 'the private KemerBet session mount contract is not exact'
  grep -Fxq 'volume|/run/fetanagent-kemerbet-session-control|true' <<<"$mount_contract" ||
    die 'the private KemerBet session mount contract is not exact'
  grep -Fxq 'volume|/var/lib/fetanagent/kemerbet-sessions|true' <<<"$mount_contract" ||
    die 'the private KemerBet session mount contract is not exact'
  grep -Fxq 'bind|/run/secrets/kemerbet_agent_identity_hmac_key|false' <<<"$mount_contract" ||
    die 'the private KemerBet session mount contract is not exact'
  grep -Fxq 'bind|/run/secrets/kemerbet_agent_identity_bindings|false' <<<"$mount_contract" ||
    die 'the private KemerBet session mount contract is not exact'
  grep -Fxq 'bind|/etc/fetanagent/kemerbet-selector-contract.v2.json|false' <<<"$mount_contract" ||
    die 'the private KemerBet session mount contract is not exact'
  grep -Fxq 'bind|/run/fetanagent-kemerbet-readiness-seal-output|true' <<<"$mount_contract" ||
    die 'the private KemerBet session mount contract is not exact'

  identity_key_source="$(docker_local container inspect "$container_id" \
    --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/kemerbet_agent_identity_hmac_key"}}{{.Source}}{{end}}{{end}}')"
  binding_source="$(docker_local container inspect "$container_id" \
    --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/kemerbet_agent_identity_bindings"}}{{.Source}}{{end}}{{end}}')"
  selector_source="$(docker_local container inspect "$container_id" \
    --format '{{range .Mounts}}{{if eq .Destination "/etc/fetanagent/kemerbet-selector-contract.v2.json"}}{{.Source}}{{end}}{{end}}')"
  readiness_output_source="$(docker_local container inspect "$container_id" \
    --format '{{range .Mounts}}{{if eq .Destination "/run/fetanagent-kemerbet-readiness-seal-output"}}{{.Source}}{{end}}{{end}}')"
  profile_volume_source="$(docker_local container inspect "$container_id" \
    --format '{{range .Mounts}}{{if eq .Destination "/var/lib/fetanagent/kemerbet-sessions"}}{{.Name}}{{end}}{{end}}')"
  [[ "$identity_key_source" == "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" &&
    "$binding_source" == "$KEMERBET_AGENT_IDENTITY_BINDINGS" &&
    "$selector_source" == "$KEMERBET_SELECTOR_CONTRACT" &&
    "$readiness_output_source" == "$KEMERBET_READINESS_OUTPUT_ROOT" &&
    "$profile_volume_source" == "$KEMERBET_PROFILE_VOLUME" ]] ||
    die 'the private KemerBet readiness input or output source is not exact'
  require_kemerbet_profile_volume_holders "$container_id"

  owner_container="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter 'label=com.docker.compose.service=owner-control')" ||
    die 'the Owner container inventory could not be inspected for private socket binding'
  [[ "$owner_container" =~ ^[0-9a-f]{12,64}$ ]] ||
    die 'the Owner container inventory is not singular for private socket binding'
  owner_socket_source="$(docker_local container inspect "$owner_container" \
    --format '{{range .Mounts}}{{if eq .Destination "/run/fetanagent-kemerbet-session-control"}}{{.Name}}{{end}}{{end}}')"
  session_socket_source="$(docker_local container inspect "$container_id" \
    --format '{{range .Mounts}}{{if eq .Destination "/run/fetanagent-kemerbet-session-control"}}{{.Name}}{{end}}{{end}}')"
  [[ "$owner_socket_source" == "$KEMERBET_SESSION_CONTROL_VOLUME" &&
    "$session_socket_source" == "$KEMERBET_SESSION_CONTROL_VOLUME" ]] ||
    die 'the Owner and private KemerBet session containers do not share one exact socket volume'
  docker_local container exec "$owner_container" node --input-type=module --eval '
    import http from "node:http";
    const request = http.get({
      socketPath: "/run/fetanagent-kemerbet-session-control/session.sock",
      path: "/healthz",
    }, (response) => process.exit(response.statusCode === 200 ? 0 : 21));
    request.on("error", () => process.exit(22));
    request.setTimeout(3000, () => request.destroy());
  ' || die 'Owner cannot reach the exact private KemerBet session socket'
}

checkpoint_kemerbet_session_for_recheck() {
  local container_id="$1"

  [[ "$container_id" =~ ^[0-9a-f]{12,64}$ ]] ||
    die 'the private KemerBet session checkpoint container is invalid'
  docker_local container exec "$container_id" node --input-type=module --eval '
    import { randomUUID } from "node:crypto";
    import http from "node:http";

    const body = JSON.stringify({ requestId: randomUUID() });
    const request = http.request({
      headers: {
        "content-length": Buffer.byteLength(body),
        "content-type": "application/json",
      },
      method: "POST",
      path: "/v1/session/checkpoint",
      socketPath: "/run/fetanagent-kemerbet-session-control/session.sock",
    }, (response) => {
      const chunks = [];
      let bytes = 0;
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > 512) {
          request.destroy();
          process.exitCode = 31;
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        if (process.exitCode !== undefined || response.statusCode !== 201) {
          process.exitCode = process.exitCode ?? 32;
          return;
        }
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const keys = Object.keys(result).sort().join(",");
          if (
            keys !== "checkpointed,identifiersRedacted,moneyMoved,providerSessionFresh,transferDisabled" ||
            result.checkpointed !== true ||
            result.providerSessionFresh !== true ||
            result.transferDisabled !== true ||
            result.moneyMoved !== false ||
            result.identifiersRedacted !== true
          ) {
            process.exitCode = 33;
          }
        } catch {
          process.exitCode = 34;
        }
      });
    });
    request.on("error", () => {
      process.exitCode = 35;
    });
    request.setTimeout(125000, () => request.destroy());
    request.end(body);
  ' || die 'the private KemerBet provider-session checkpoint failed closed before cohort promotion'
}

require_fresh_bot_disabled_ready() {
  local commit_sha="$1"

  require_exact_fresh_private_runtime "$commit_sha"
  require_service_file "$SECRET_ROOT/bot-token"
  grep -Fxq 'telegram-disabled-until-separate-smoke' "$SECRET_ROOT/bot-token" ||
    die 'the fresh-host Telegram token is not the reviewed disabled sentinel'
}

require_ipv6_host_ready() {
  command -v ip >/dev/null 2>&1 || die 'the ip utility is unavailable'
  command -v getent >/dev/null 2>&1 || die 'the getent utility is unavailable'
  ip -6 address show scope global | grep -q 'inet6 ' || die 'the VM has no global IPv6 address'
  ip -6 route show default | grep -q '^default ' || die 'the VM has no default IPv6 route'
  getent ahostsv6 "$STAGING_DIRECT_DATABASE_HOST" >/dev/null ||
    die 'the exact staging direct database host has no resolvable IPv6 address'
}

require_base_legacy_stopped_receipt() {
  command -v cmp >/dev/null 2>&1 || die 'the cmp utility is unavailable'
  command -v stat >/dev/null 2>&1 || die 'the stat utility is unavailable'
  [[ ! -L "$LEGACY_STOPPED_RECEIPT" && -f "$LEGACY_STOPPED_RECEIPT" ]] ||
    die 'the legacy-stopped transition receipt is absent or symbolic'
  [[ "$(stat --format='%U:%G:%a' "$LEGACY_STOPPED_RECEIPT")" == 'root:root:600' ]] ||
    die 'the legacy-stopped transition receipt ownership or mode is unsafe'
  cmp -s -- "$LEGACY_STOPPED_RECEIPT" <(printf '%s\n' \
    "transition_version=$TRANSITION_VERSION" \
    "droplet_id=$STAGING_DROPLET_ID" \
    "legacy_helper_sha=$LEGACY_HELPER_SHA" \
    "new_helper_sha=$BASE_HELPER_SHA" \
    "acknowledged_commit=$BASE_REVIEWED_COMMIT" \
    'legacy_stopped=true') ||
    die 'the immutable legacy-stopped transition receipt does not match the sealed base transition'
}

require_legacy_stopped() {
  local commit_sha="$1"
  local current_helper_sha

  command -v sha256sum >/dev/null 2>&1 || die 'the sha256sum utility is unavailable'
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
    die 'the reviewed main commit must be 40 lowercase hexadecimal characters'
  if ! current_helper_sha="$(sha256sum "$HELPER_PATH" | awk '{ print $1 }')"; then
    die 'the installed helper digest could not be computed'
  fi
  require_base_legacy_stopped_receipt
  require_base_retired_receipt
  require_helper_rotation_overlay pending-or-complete "$commit_sha" "$current_helper_sha"
}

require_base_retired_receipt() {
  [[ ! -L "$TRANSITION_RECEIPT" && -f "$TRANSITION_RECEIPT" ]] ||
    die 'the immutable VM retirement receipt is absent or symbolic'
  [[ "$(stat --format='%U:%G:%a' "$TRANSITION_RECEIPT")" == 'root:root:600' ]] ||
    die 'the immutable VM retirement receipt ownership or mode is unsafe'
  cmp -s -- "$TRANSITION_RECEIPT" <(printf '%s\n' \
    "transition_version=$TRANSITION_VERSION" \
    "droplet_id=$STAGING_DROPLET_ID" \
    "legacy_helper_sha=$LEGACY_HELPER_SHA" \
    "new_helper_sha=$BASE_HELPER_SHA" \
    "acknowledged_commit=$BASE_REVIEWED_COMMIT" \
    'retired=true') ||
    die 'the immutable retirement receipt does not match the sealed base transition'
}

require_helper_rotation_overlay() {
  local expected_state="$1"
  local commit_sha="$2"
  local current_helper_sha="$3"

  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ && "$commit_sha" != "$BASE_REVIEWED_COMMIT" ]] ||
    die 'the helper rotation must target a distinct reviewed main commit'
  [[ "$current_helper_sha" =~ ^[0-9a-f]{64}$ && "$current_helper_sha" != "$BASE_HELPER_SHA" ]] ||
    die 'the helper rotation must target a distinct reviewed helper digest'
  [[ ! -L "$HELPER_ROTATION_RECEIPT" && -f "$HELPER_ROTATION_RECEIPT" ]] ||
    die 'the helper-rotation receipt is absent or symbolic'
  [[ "$(stat --format='%U:%G:%a' "$HELPER_ROTATION_RECEIPT")" == 'root:root:600' ]] ||
    die 'the helper-rotation receipt ownership or mode is unsafe'

  if cmp -s -- "$HELPER_ROTATION_RECEIPT" <(printf '%s\n' \
    "transition_version=$TRANSITION_VERSION" \
    "droplet_id=$STAGING_DROPLET_ID" \
    "old_helper_sha=$BASE_HELPER_SHA" \
    "new_helper_sha=$current_helper_sha" \
    "old_reviewed_commit=$BASE_REVIEWED_COMMIT" \
    "new_reviewed_commit=$commit_sha" \
    'rotation_complete=true'); then
    return
  fi
  [[ "$expected_state" == 'pending-or-complete' ]] ||
    die 'the helper-rotation receipt is not finalized for public activation'
  cmp -s -- "$HELPER_ROTATION_RECEIPT" <(printf '%s\n' \
    "transition_version=$TRANSITION_VERSION" \
    "droplet_id=$STAGING_DROPLET_ID" \
    "old_helper_sha=$BASE_HELPER_SHA" \
    "new_helper_sha=$current_helper_sha" \
    "old_reviewed_commit=$BASE_REVIEWED_COMMIT" \
    "new_reviewed_commit=$commit_sha" \
    'rotation_pending=true') ||
    die 'the helper-rotation receipt does not match an allowed pending or complete state'
}

require_no_legacy_identity_processes() {
  local legacy_uid process_status

  command -v id >/dev/null 2>&1 || die 'the id utility is unavailable'
  command -v pgrep >/dev/null 2>&1 || die 'the pgrep utility is unavailable'
  legacy_uid="$(id -u "$LEGACY_ADMIN")" ||
    die 'the legacy deployment identity UID could not be inspected'
  [[ "$legacy_uid" =~ ^[0-9]+$ && "$legacy_uid" -ne 0 ]] ||
    die 'the legacy deployment identity has an unsafe UID'
  if pgrep -u "$legacy_uid" >/dev/null 2>&1; then
    die 'a process owned by the legacy deployment identity remains'
  else
    process_status="$?"
    [[ "$process_status" -eq 1 ]] || die 'the legacy identity process inventory failed'
  fi
}

require_no_legacy_helper_processes() {
  local process_status

  command -v pgrep >/dev/null 2>&1 || die 'the pgrep utility is unavailable'
  if pgrep -f -- "$LEGACY_HELPER" >/dev/null 2>&1; then
    die 'a legacy deployment-helper process remains'
  else
    process_status="$?"
    [[ "$process_status" -eq 1 ]] || die 'the legacy helper process inventory failed'
  fi
}

require_legacy_execution_boundary_sealed() {
  local entry groups home password_status shell status uid unsafe_sudoers_entry
  local authorized_keys="$LEGACY_HOME/.ssh/authorized_keys"
  local marker candidate

  command -v find >/dev/null 2>&1 || die 'the find utility is unavailable'
  command -v getent >/dev/null 2>&1 || die 'the getent utility is unavailable'
  command -v grep >/dev/null 2>&1 || die 'the grep utility is unavailable'
  command -v id >/dev/null 2>&1 || die 'the id utility is unavailable'
  command -v passwd >/dev/null 2>&1 || die 'the passwd utility is unavailable'

  [[ ! -L "$LEGACY_HOME" && -d "$LEGACY_HOME" ]] ||
    die 'the legacy home is absent, non-directory, or symbolic'
  if [[ -e "$LEGACY_HOME/.ssh" || -L "$LEGACY_HOME/.ssh" ]]; then
    [[ ! -L "$LEGACY_HOME/.ssh" && -d "$LEGACY_HOME/.ssh" ]] ||
      die 'the legacy SSH directory is non-directory or symbolic'
  fi
  [[ ! -e "$authorized_keys" && ! -L "$authorized_keys" ]] ||
    die 'legacy authorized_keys remains after execution-boundary sealing'

  [[ ! -e "$LEGACY_SUDOERS" && ! -L "$LEGACY_SUDOERS" ]] ||
    die 'the exact legacy sudoers file remains after retirement'

  [[ ! -L /etc/sudoers && -f /etc/sudoers ]] ||
    die 'the primary sudoers policy cannot be safely inspected'
  [[ ! -L /etc/sudoers.d && -d /etc/sudoers.d ]] ||
    die 'the sudoers fragment directory cannot be safely inspected'
  if ! unsafe_sudoers_entry="$(find /etc/sudoers.d -mindepth 1 ! -type f -print -quit)"; then
    die 'the sudoers fragment tree could not be inspected'
  fi
  [[ -z "$unsafe_sudoers_entry" ]] ||
    die 'the sudoers fragment tree contains a non-regular entry'
  for marker in "$LEGACY_ADMIN" "$LEGACY_HELPER"; do
    if grep -Fq -- "$marker" /etc/sudoers 2>/dev/null; then
      die 'a legacy sudo permission remains in the primary sudoers policy'
    else
      status=$?
      [[ "$status" -eq 1 ]] || die 'the primary sudoers policy could not be inspected'
    fi
    if grep -r -Fq -- "$marker" /etc/sudoers.d 2>/dev/null; then
      die 'a legacy sudo permission remains in a sudoers fragment'
    else
      status=$?
      [[ "$status" -eq 1 ]] || die 'the sudoers fragment tree could not be inspected'
    fi
  done

  if ! entry="$(getent passwd "$LEGACY_ADMIN")"; then
    die 'the legacy deployment identity is absent'
  fi
  IFS=':' read -r _ _ uid _ _ home shell <<<"$entry"
  [[ "$uid" =~ ^[0-9]+$ && "$uid" -ne 0 ]] ||
    die 'the legacy deployment identity has an unsafe UID'
  [[ "$home" == "$LEGACY_HOME" ]] ||
    die 'the legacy deployment identity has an unexpected home'
  [[ "$shell" == '/usr/sbin/nologin' ]] ||
    die 'the legacy deployment identity is still interactive'
  if ! password_status="$(passwd --status "$LEGACY_ADMIN" | awk '{ print $2 }')"; then
    die 'the legacy deployment identity password state could not be inspected'
  fi
  [[ "$password_status" == 'L' ]] ||
    die 'the legacy deployment identity password is not locked'
  groups="$(id -nG "$LEGACY_ADMIN" | tr ' ' '\n')" ||
    die 'the legacy deployment identity groups could not be inspected'
  ! grep -Eq '^(docker|sudo)$' <<<"$groups" ||
    die 'the legacy deployment identity retains broad Docker or sudo-group access'

  require_no_legacy_identity_processes
  require_no_legacy_helper_processes
}

require_legacy_access_retired() {
  require_legacy_execution_boundary_sealed
  [[ ! -e "$LEGACY_HELPER" && ! -L "$LEGACY_HELPER" ]] ||
    die 'the legacy deployment helper remains after retirement'
  [[ ! -e "$LEGACY_SECRET_ROOT" && ! -L "$LEGACY_SECRET_ROOT" ]] ||
    die 'the legacy secret root remains after retirement'
}

require_private_start_cutover_ready() {
  local commit_sha="$1"

  require_legacy_stopped "$commit_sha"
  require_legacy_access_retired
  require_cutover_ready
  require_port_3002_free
}

require_fresh_host_start_ready() {
  local commit_sha="$1"
  local containers networks

  validate_commit_and_tag "$commit_sha" "${commit_sha:0:12}"
  require_fresh_host_identity
  require_ipv6_host_ready
  require_port_3002_free

  containers="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")" ||
    die 'the fresh-host FetanAgent container inventory could not be inspected'
  [[ -z "$containers" ]] || die 'fresh-host startup requires an empty FetanAgent project'

  networks="$(docker_local network ls --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")" ||
    die 'the fresh-host FetanAgent network inventory could not be inspected'
  [[ -z "$networks" ]] || die 'fresh-host startup requires no existing FetanAgent networks'
}

require_kemerbet_v3_successor_stopped_durable_boundary() {
  local containers expected_volumes networks project_volumes session_holders

  containers="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")" ||
    die 'the KemerBet v3 successor project container inventory could not be inspected'
  [[ -z "$containers" ]] ||
    die 'the KemerBet v3 successor project must be fully stopped'
  networks="$(docker_local network ls --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")" ||
    die 'the KemerBet v3 successor project network inventory could not be inspected'
  [[ -z "$networks" ]] ||
    die 'the KemerBet v3 successor project must have no network'
  require_kemerbet_recheck_transients_absent ||
    die 'the stopped KemerBet v3 successor retained a recheck runtime boundary'

  project_volumes="$(docker_local volume ls --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" | LC_ALL=C sort)" ||
    die 'the KemerBet v3 successor project volume inventory could not be inspected'
  expected_volumes="$(printf '%s\n%s\n' \
    "$KEMERBET_PROFILE_VOLUME" "$KEMERBET_SESSION_CONTROL_VOLUME" | LC_ALL=C sort)"
  [[ "$project_volumes" == "$expected_volumes" ]] ||
    die 'the KemerBet v3 successor project volume inventory is not exact'
  resolve_kemerbet_profile_volume_mountpoint >/dev/null
  require_kemerbet_profile_volume_holders ''
  resolve_kemerbet_session_control_volume_offline_mountpoint >/dev/null ||
    die 'the KemerBet session-control volume is not exact and holder-free'
  session_holders="$(docker_local container ls --all --quiet \
    --filter "volume=$KEMERBET_SESSION_CONTROL_VOLUME")" ||
    die 'the KemerBet session-control volume holder inventory could not be inspected'
  [[ -z "$session_holders" ]] ||
    die 'the stopped KemerBet v3 successor retained a session-control volume holder'
}

require_kemerbet_v3_successor_install_boundary() {
  local commit_sha="$1"
  local successor_release successor_state

  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
    die 'the KemerBet v3 successor install release identity is invalid'
  inspect_kemerbet_v2_v3_successor_gate
  successor_state="$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE"
  successor_release="$KEMERBET_V2_V3_SUCCESSOR_RELEASE"
  case "$successor_state" in
    successor-installed)
      if [[ "$KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE" == 'active' ]]; then
        require_kemerbet_v3_runtime_bridge
      else
        [[ "$successor_release" == "$commit_sha" ]] ||
          die 'release installation requires the exact same-release installed KemerBet v3 successor'
      fi
      ;;
    successor-completed)
      require_kemerbet_v3_runtime_bridge
      ;;
    *) die 'release installation requires an exact installed or completed KemerBet v3 successor' ;;
  esac
  require_kemerbet_v1_retirement_expiry_guard_disarmed ||
    die 'release installation requires a disarmed staging expiry guard'
  [[ ! -e "$BOT_STARTUP_RECEIPT" && ! -L "$BOT_STARTUP_RECEIPT" &&
    ! -e "$BOT_STARTUP_RECEIPT_ROOT" && ! -L "$BOT_STARTUP_RECEIPT_ROOT" ]] ||
    die 'release installation requires an absent Telegram runtime receipt'
  require_kemerbet_v3_successor_stopped_durable_boundary

  inspect_kemerbet_v2_v3_successor_gate
  [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == "$successor_state" &&
    "$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$successor_release" ]] ||
    die 'the KemerBet v3 successor boundary changed during install preflight'
}

require_kemerbet_v3_successor_armed_stopped_boundary() {
  local commit_sha="$1"
  local successor_release successor_state

  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
    die 'the KemerBet v3 successor armed-start release identity is invalid'
  inspect_kemerbet_v2_v3_successor_gate
  successor_state="$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE"
  successor_release="$KEMERBET_V2_V3_SUCCESSOR_RELEASE"
  case "$successor_state" in
    successor-installed)
      if [[ "$KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE" == 'active' ]]; then
        require_kemerbet_v3_runtime_bridge
      else
        [[ "$successor_release" == "$commit_sha" ]] ||
          die 'the installed KemerBet v3 successor belongs to another reviewed release'
      fi
      ;;
    successor-completed)
      require_kemerbet_v3_runtime_bridge
      ;;
    *) die 'the stopped KemerBet v3 successor state is invalid' ;;
  esac
  require_kemerbet_v1_retirement_expiry_guard_armed ||
    die 'the KemerBet v3 successor requires an exact armed expiry guard before startup'
  require_fresh_host_start_ready "$commit_sha"
  [[ ! -e "$BOT_STARTUP_RECEIPT" && ! -L "$BOT_STARTUP_RECEIPT" &&
    ! -e "$BOT_STARTUP_RECEIPT_ROOT" && ! -L "$BOT_STARTUP_RECEIPT_ROOT" ]] ||
    die 'the stopped KemerBet v3 successor retained a Telegram runtime receipt'
  require_kemerbet_v3_successor_stopped_durable_boundary
  inspect_kemerbet_v2_v3_successor_gate
  [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == "$successor_state" &&
    "$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$successor_release" ]] ||
    die 'the armed expiry guard is not bound to the exact stopped KemerBet v3 successor'
}

require_fresh_host_identity() {
  local metadata_droplet_id metadata_ipv4

  command -v curl >/dev/null 2>&1 || die 'curl is unavailable for fresh-host identity proof'
  metadata_droplet_id="$(curl --fail --silent --show-error --noproxy '*' --max-time 3 \
    http://169.254.169.254/metadata/v1/id)" ||
    die 'the fresh-host DigitalOcean identity could not be read'
  metadata_ipv4="$(curl --fail --silent --show-error --noproxy '*' --max-time 3 \
    http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address)" ||
    die 'the fresh-host DigitalOcean public IPv4 could not be read'
  [[ "$metadata_droplet_id" == "$FRESH_STAGING_DROPLET_ID" ]] ||
    die 'the fresh-host DigitalOcean identity is not the reviewed staging Droplet'
  [[ "$metadata_ipv4" == "$FRESH_PUBLIC_IPV4" ]] ||
    die 'the fresh-host DigitalOcean public IPv4 is not the reviewed staging address'
}

require_transition_retired() {
  local commit_sha="$1"
  local current_helper_sha

  command -v sha256sum >/dev/null 2>&1 || die 'the sha256sum utility is unavailable'
  command -v stat >/dev/null 2>&1 || die 'the stat utility is unavailable'

  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
    die 'the reviewed main commit must be 40 lowercase hexadecimal characters'
  if ! current_helper_sha="$(sha256sum "$HELPER_PATH" | awk '{ print $1 }')"; then
    die 'the installed helper digest could not be computed'
  fi
  require_base_legacy_stopped_receipt
  require_base_retired_receipt

  require_helper_rotation_overlay complete "$commit_sha" "$current_helper_sha"

  require_legacy_access_retired
  require_cutover_ready
  require_exact_private_runtime "$commit_sha"
}

require_public_network_ready() {
  local public_ipv4="$1"
  local domain port resolved_output status
  local -a resolved
  command -v getent >/dev/null 2>&1 || die 'the getent utility is unavailable'
  command -v ss >/dev/null 2>&1 || die 'the ss utility is unavailable'
  command -v ufw >/dev/null 2>&1 || die 'UFW is unavailable'

  status="$(ufw status)"
  grep -Fxq 'Status: active' <<<"$status" || die 'UFW is not active'
  for port in 80 443; do
    grep -Eq "^${port}/tcp[[:blank:]]+ALLOW[[:blank:]]+Anywhere[[:blank:]]*$" <<<"$status" ||
      die "UFW does not allow $port/tcp"
    grep -Eq "^${port}/tcp \(v6\)[[:blank:]]+ALLOW[[:blank:]]+Anywhere \(v6\)[[:blank:]]*$" <<<"$status" ||
      die "UFW does not allow $port/tcp over IPv6"
  done

  if ss -ltnH | awk '$4 ~ /:(80|443)$/ { found = 1 } END { exit !found }'; then
    die 'TCP port 80 or 443 is already in use'
  fi

  for domain in "${PUBLIC_DOMAINS[@]}"; do
    resolved_output="$(getent ahostsv4 "$domain")" || die "$domain is not resolvable over IPv4"
    mapfile -t resolved <<<"$(awk '{ print $1 }' <<<"$resolved_output" | sort -u)"
    [[ "${#resolved[@]}" -eq 1 && "${resolved[0]}" == "$public_ipv4" ]] ||
      die "$domain does not resolve only to the reviewed staging IPv4 address"
  done
}

require_public_edge_ready() {
  local commit_sha="$1"

  require_transition_retired "$commit_sha"
  require_public_network_ready "$PUBLIC_IPV4"
}

require_fresh_public_edge_ready() {
  local commit_sha="$1"

  validate_commit_and_tag "$commit_sha" "${commit_sha:0:12}"
  require_fresh_host_identity
  require_exact_fresh_bot_runtime "$commit_sha" steady-state
  require_public_network_ready "$FRESH_PUBLIC_IPV4"
}

command="${1:-}"
[[ $EUID -eq 0 ]] || die 'the helper must run as root through sudo or the fixed systemd expiry guard'
if [[ "$command" == 'expiry-stop' ]]; then
  [[ -z "${SUDO_USER:-}" && -n "${INVOCATION_ID:-}" && "${FETANAGENT_STAGING_EXPIRY_GUARD:-}" == '1' ]] ||
    die 'expiry-stop may run only from the fixed systemd guard'
else
  [[ "${SUDO_USER:-}" == "$EXPECTED_SUDO_USER" ]] ||
    die 'the helper requires the dedicated deployment identity'
fi
[[ "$0" == "$HELPER_PATH" ]] || die 'the helper must run from its root-owned installed path'
[[ ! -L "$HELPER_PATH" && "$(stat --format='%U:%G:%a' "$HELPER_PATH")" == 'root:root:755' ]] ||
  die 'the installed helper ownership or mode is unsafe'
[[ -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] || die 'Docker overrides are forbidden'

case "$command" in
  arm-expiry-stop|bot-ready|discard|expiry-stop|fresh-start|install|install-bot-token|recheck-kemerbet-readiness|reinstall-kemerbet-v1-retirement-secrets|retire-kemerbet-readiness-binding-v1-for-v2-reseal|seal-kemerbet-readiness|start|start-bot|start-fresh-public-edge|start-kemerbet-session-provision|start-public-edge|stop|stop-bot|stop-kemerbet-session-provision|stop-public-edge)
    acquire_staging_mutation_lock
    if [[ ! "$command" =~ ^(recheck-kemerbet-readiness|expiry-stop|stop|stop-bot|stop-kemerbet-session-provision|stop-public-edge)$ &&
      ( -e "$KEMERBET_RECHECK_PROMOTION_ROOT" || -L "$KEMERBET_RECHECK_PROMOTION_ROOT" ||
        -e "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_NAME" ||
        -L "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_NAME" ||
        -e "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME" ||
        -L "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME" ) ]]; then
      die 'an interrupted KemerBet readiness recovery blocks state-expanding staging mutations'
    fi
    ;;
esac

inspect_kemerbet_v2_v3_successor_gate
if [[ "$command" == 'kemerbet-v1-retirement-recovery-ready' ]]; then
  [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'absent' ]] ||
    die 'the KemerBet v3 successor permanently forbids legacy v1 retirement recovery'
else
  if [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'absent' ]]; then
    enforce_kemerbet_v1_retirement_gate "$command" "${@:2}"
  fi
  enforce_kemerbet_v2_v3_successor_gate "$command" "${@:2}"
fi

case "$command" in
  verify)
    [[ $# -eq 2 && "$2" =~ ^[0-9a-f]{64}$ ]] || die 'verify requires one SHA-256 digest'
    [[ "$(sha256sum "$HELPER_PATH" | awk '{print $1}')" == "$2" ]] ||
      die 'the installed helper does not match the reviewed repository helper'
    ;;

  kemerbet-v3-runtime-bridge-ready)
    [[ $# -eq 2 && "$2" =~ ^[0-9a-f]{64}$ ]] ||
      die 'kemerbet-v3-runtime-bridge-ready requires the exact helper digest'
    require_kemerbet_v3_runtime_bridge
    [[ "$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256" == "$2" ]] ||
      die 'the KemerBet v3 runtime bridge helper digest is not exact'
    printf '%s\n' \
      "KemerBet v3 runtime bridge ready: historical overlay $KEMERBET_V2_V3_SUCCESSOR_RELEASE; current releases remain Transfer-disabled."
    ;;

  docker-storage-ready)
    [[ $# -eq 2 && "$2" =~ ^[1-9][0-9]{0,11}$ ]] ||
      die 'docker-storage-ready requires the exact positive release-bundle byte count'
    bundle_bytes="$2"
    (( bundle_bytes <= 64 * 1024 * 1024 * 1024 )) ||
      die 'the release-bundle byte count exceeds the reviewed bound'
    command -v df >/dev/null 2>&1 || die 'df is unavailable for the Docker storage check'
    command -v awk >/dev/null 2>&1 || die 'awk is unavailable for the Docker storage check'
    [[ ! -L "$DOCKER_DATA_ROOT" && -d "$DOCKER_DATA_ROOT" &&
      "$(realpath -- "$DOCKER_DATA_ROOT")" == "$DOCKER_DATA_ROOT" ]] ||
      die 'the Docker data root is absent or unsafe'
    available_bytes="$(LC_ALL=C df --output=avail -B1 -- "$DOCKER_DATA_ROOT" |
      awk 'NR == 2 && $1 ~ /^[0-9]+$/ { value = $1 } END { if (NR != 2 || value == "") exit 1; print value }')" ||
      die 'Docker storage availability could not be measured'
    [[ "$available_bytes" =~ ^[1-9][0-9]*$ ]] ||
      die 'Docker storage availability is invalid'
    required_bytes=$((bundle_bytes * 2 + 4 * 1024 * 1024 * 1024))
    (( available_bytes >= required_bytes )) ||
      die 'insufficient Docker storage for the reviewed release bundle and rollback reserve'
    printf '%s\n' 'Docker storage ready for the reviewed release bundle and rollback reserve.'
    ;;

  kemerbet-v3-successor-ready)
    [[ $# -eq 3 && "$2" =~ ^[0-9a-f]{40}$ && "$3" =~ ^[0-9a-f]{64}$ ]] ||
      die 'kemerbet-v3-successor-ready requires the exact successor release and helper digest'
    inspect_kemerbet_v2_v3_successor_gate
    [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'successor-installed' &&
      "$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$2" &&
      "$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256" == "$3" ]] ||
      die 'the KemerBet v3 successor overlay is not exactly ready'
    printf '%s\n' 'KemerBet v3 successor overlay ready: stable Profile binding, Transfer disabled.'
    ;;

  stop)
    [[ $# -eq 1 ]] || die 'stop accepts no additional arguments'
    recover_kemerbet_recheck_before_teardown
    if [[ "$KEMERBET_TEARDOWN_RECOVERY_FAILED" == 'true' ]]; then
      emergency_stop_project_after_kemerbet_recovery_failure ||
        KEMERBET_EMERGENCY_TEARDOWN_FAILED='true'
      emergency_disarm_expiry_stop_after_kemerbet_recovery_failure ||
        KEMERBET_EMERGENCY_TEARDOWN_FAILED='true'
      abort_kemerbet_v1_reinstall_journal_after_full_expiry ||
        KEMERBET_EMERGENCY_TEARDOWN_FAILED='true'
      finalize_kemerbet_v1_retirement_safe_reset_after_full_teardown ||
        KEMERBET_EMERGENCY_TEARDOWN_FAILED='true'
    else
      stop_project
      disarm_expiry_stop
      abort_kemerbet_v1_reinstall_journal_after_full_expiry ||
        die 'the fully expired v1 retirement secret-recovery journal could not be retired'
      finalize_kemerbet_v1_retirement_safe_reset_after_full_teardown ||
        die 'the fully expired v2 retirement seal prefix could not be finalized safely'
    fi
    require_kemerbet_teardown_recovery_success
    ;;

  arm-expiry-stop)
    [[ $# -eq 3 ]] || die 'arm-expiry-stop requires a reviewed commit and canonical UTC stop time'
    arm_expiry_stop "$2" "$3"
    if [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" != 'absent' ]]; then
      require_kemerbet_v3_successor_armed_stopped_boundary "$2"
    else
      inspect_kemerbet_v1_retirement_gate
      if [[ "$KEMERBET_V1_RETIREMENT_GATE_STATE" =~ \
        ^(pending|resealed-awaiting-recheck)$ ]]; then
        [[ "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" == "$2" ]] ||
          die 'the armed recovery expiry guard does not match the v1 retirement release'
        require_kemerbet_v1_retirement_expiry_guard_armed ||
          die 'the same-release recovery expiry guard failed exact post-arm attestation'
        require_exact_fresh_private_runtime "$2"
        require_kemerbet_v1_retirement_current_context "$2" ||
          die 'the v1 retirement context changed while arming recovery expiry'
        kemerbet_v1_retirement_release_asset_digest "$2" >/dev/null ||
          die 'the same-release recovery assets changed while arming expiry'
      fi
    fi
    ;;

  expiry-stop)
    [[ $# -eq 1 ]] || die 'expiry-stop accepts no additional arguments'
    recover_kemerbet_recheck_before_teardown
    if [[ "$KEMERBET_TEARDOWN_RECOVERY_FAILED" == 'true' ]]; then
      emergency_stop_project_after_kemerbet_recovery_failure ||
        KEMERBET_EMERGENCY_TEARDOWN_FAILED='true'
      emergency_disarm_expiry_stop_after_kemerbet_recovery_failure ||
        KEMERBET_EMERGENCY_TEARDOWN_FAILED='true'
      abort_kemerbet_v1_reinstall_journal_after_full_expiry ||
        KEMERBET_EMERGENCY_TEARDOWN_FAILED='true'
      finalize_kemerbet_v1_retirement_safe_reset_after_full_teardown ||
        KEMERBET_EMERGENCY_TEARDOWN_FAILED='true'
    else
      stop_project
      disarm_expiry_stop
      abort_kemerbet_v1_reinstall_journal_after_full_expiry ||
        die 'the fully expired v1 retirement secret-recovery journal could not be retired'
      finalize_kemerbet_v1_retirement_safe_reset_after_full_teardown ||
        die 'the fully expired v2 retirement seal prefix could not be finalized safely'
    fi
    require_kemerbet_teardown_recovery_success
    ;;

  cutover-ready)
    [[ $# -eq 2 ]] || die 'cutover-ready requires one reviewed main commit'
    require_legacy_stopped "$2"
    require_cutover_ready
    require_port_3002_free
    ;;

  fresh-host-ready)
    [[ $# -eq 2 ]] || die 'fresh-host-ready requires one reviewed main commit'
    require_fresh_host_start_ready "$2"
    ;;

  network-ready)
    [[ $# -eq 1 ]] || die 'network-ready accepts no additional arguments'
    require_ipv6_host_ready
    ;;

  discard)
    [[ $# -eq 2 && "$2" =~ ^[0-9a-f]{40}$ ]] || die 'discard requires one full commit SHA'
    incoming="/tmp/fetanagent-$2"
    if [[ -e "$incoming" || -L "$incoming" ]]; then
      [[ ! -L "$incoming" && -d "$incoming" ]] || die 'the incoming cleanup target is unsafe'
      [[ "$(stat --format='%U:%a' "$incoming")" == "$EXPECTED_SUDO_USER:700" ]] ||
        die 'the incoming cleanup target ownership or mode is unsafe'
      rm -rf -- "$incoming"
    fi
    ;;

  install)
    [[ $# -eq 4 ]] || die 'install requires a commit, image tag, and incoming directory'
    commit_sha="$2"
    image_tag="$3"
    incoming="$4"
    validate_commit_and_tag "$commit_sha" "$image_tag"
    successor_install_state="$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE"
    successor_install_release="$KEMERBET_V2_V3_SUCCESSOR_RELEASE"
    successor_install_helper_sha="$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256"
    successor_install_bridge_release="$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE"
    [[ "$incoming" == "/tmp/fetanagent-$commit_sha" ]] || die 'the incoming directory is outside the approved path'
    [[ ! -L "$incoming" && -d "$incoming" ]] || die 'the incoming directory is absent or symbolic'
    [[ "$(stat --format='%U:%a' "$incoming")" == "$EXPECTED_SUDO_USER:700" ]] ||
      die 'the incoming directory ownership or mode is unsafe'
    if [[ "$successor_install_state" != 'absent' ]]; then
      require_kemerbet_v3_successor_install_boundary "$commit_sha"
    fi

    expected_files="$({ printf '%s\n' \
      api-action-capability-hmac api-action-payload-hmac api-action-semantic-hmac \
      cbe-deposit-reference-encryption-key cbe-deposit-reference-fingerprint-key \
      cbe-deposit-reference-key-profile.v1.json \
      deposit-proof-reference-encryption-master deposit-proof-reference-fingerprint-master \
      deposit-proof-reference-profile.v2.json \
      customer-web-database-url customer-web-publishable-key customer-web-rate-limit-hmac \
      api-action-transport-hmac \
      beta-database-url beta-payload-hmac beta-transport-hmac bot-token bot-transport-hmac \
      bot-action-transport-hmac player-action-database-url \
      compose.staging-beta.yaml owner-database-url fetanagent-staging-images.tar publishable-key \
      supabase-ca.crt; } | sort)"
    actual_files="$(find "$incoming" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort)"
    [[ "$actual_files" == "$expected_files" ]] || die 'the incoming release file set is not exact'
    while IFS= read -r incoming_file; do
      [[ ! -L "$incoming/$incoming_file" && -f "$incoming/$incoming_file" ]] ||
        die 'an incoming release input is not a regular file'
    done <<<"$actual_files"

    release="$RELEASE_ROOT/$commit_sha"
    install -d -o root -g root -m 0755 "$release/infra" "$SECRET_ROOT"
    install -o root -g root -m 0444 \
      "$incoming/compose.staging-beta.yaml" "$release/infra/compose.staging-beta.yaml"
    install -o 10001 -g 10001 -m 0400 "$incoming/beta-database-url" "$SECRET_ROOT/beta-database-url"
    install -o 10001 -g 10001 -m 0400 "$incoming/owner-database-url" "$SECRET_ROOT/owner-database-url"
    install -o 10001 -g 10001 -m 0400 "$incoming/customer-web-database-url" "$SECRET_ROOT/customer-web-database-url"
    install -o 10001 -g 10001 -m 0400 "$incoming/customer-web-publishable-key" "$SECRET_ROOT/customer-web-publishable-key"
    install -o 10001 -g 10001 -m 0400 "$incoming/customer-web-rate-limit-hmac" "$SECRET_ROOT/customer-web-rate-limit-hmac"
    install -o 10001 -g 10001 -m 0400 "$incoming/beta-transport-hmac" "$SECRET_ROOT/beta-transport-hmac"
    install -o 10001 -g 10001 -m 0400 "$incoming/bot-transport-hmac" "$SECRET_ROOT/bot-transport-hmac"
    install -o 10001 -g 10001 -m 0400 "$incoming/beta-payload-hmac" "$SECRET_ROOT/beta-payload-hmac"
    install -o 10001 -g 10001 -m 0400 "$incoming/player-action-database-url" "$SECRET_ROOT/player-action-database-url"
    install -o 10001 -g 10001 -m 0400 "$incoming/api-action-transport-hmac" "$SECRET_ROOT/api-action-transport-hmac"
    install -o 10001 -g 10001 -m 0400 "$incoming/api-action-payload-hmac" "$SECRET_ROOT/api-action-payload-hmac"
    install -o 10001 -g 10001 -m 0400 "$incoming/api-action-capability-hmac" "$SECRET_ROOT/api-action-capability-hmac"
    install -o 10001 -g 10001 -m 0400 "$incoming/api-action-semantic-hmac" "$SECRET_ROOT/api-action-semantic-hmac"
    install -o 10001 -g 10001 -m 0400 "$incoming/cbe-deposit-reference-encryption-key" "$SECRET_ROOT/cbe-deposit-reference-encryption-key"
    install -o 10001 -g 10001 -m 0400 "$incoming/cbe-deposit-reference-fingerprint-key" "$SECRET_ROOT/cbe-deposit-reference-fingerprint-key"
    install -o root -g root -m 0444 "$incoming/cbe-deposit-reference-key-profile.v1.json" "$SECRET_ROOT/cbe-deposit-reference-key-profile.v1.json"
    install -o 10001 -g 10001 -m 0400 "$incoming/deposit-proof-reference-encryption-master" "$SECRET_ROOT/deposit-proof-reference-encryption-master"
    install -o 10001 -g 10001 -m 0400 "$incoming/deposit-proof-reference-fingerprint-master" "$SECRET_ROOT/deposit-proof-reference-fingerprint-master"
    install -o root -g root -m 0444 "$incoming/deposit-proof-reference-profile.v2.json" "$SECRET_ROOT/deposit-proof-reference-profile.v2.json"
    install -o 10001 -g 10001 -m 0400 "$incoming/bot-action-transport-hmac" "$SECRET_ROOT/bot-action-transport-hmac"
    install -o 10001 -g 10001 -m 0400 "$incoming/bot-token" "$SECRET_ROOT/bot-token"
    install -o 10001 -g 10001 -m 0400 "$incoming/publishable-key" "$SECRET_ROOT/publishable-key"
    install -o root -g root -m 0444 "$incoming/supabase-ca.crt" "$SECRET_ROOT/supabase-ca.crt"

    docker_local image load --input "$incoming/fetanagent-staging-images.tar" >/dev/null
    for image in owner-control customer-web api beta-admission bot deposit-executor gateway; do
      [[ "$(docker_local image inspect "fetanagent-$image:$image_tag" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$commit_sha" ]] ||
        die 'a loaded image revision does not match the reviewed commit'
    done
    rm -rf -- "$incoming"
    if [[ "$successor_install_state" != 'absent' ]]; then
      inspect_kemerbet_v2_v3_successor_gate
      [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == "$successor_install_state" &&
        "$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$successor_install_release" &&
        "$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256" == "$successor_install_helper_sha" &&
        "$KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE" == 'active' &&
        "$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE" == "$successor_install_bridge_release" ]] ||
        die 'release installation changed the historical KemerBet overlay or runtime bridge'
    fi
    ;;

  start|fresh-start)
    [[ $# -eq 3 ]] || die 'start and fresh-start require a commit and image tag'
    commit_sha="$2"
    image_tag="$3"
    validate_commit_and_tag "$commit_sha" "$image_tag"
    successor_start_state="$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE"
    successor_start_release="$KEMERBET_V2_V3_SUCCESSOR_RELEASE"
    successor_start_helper_sha="$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256"
    successor_start_bridge_release="$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE"
    # This command is an independently callable privileged boundary. Prove the
    # reviewed transition (legacy cutover or clean fresh-host state) before
    # reading deploy inputs, running database preflights, or starting a container.
    migration_recovery_start='false'
    if [[ "$command" == 'fresh-start' ]]; then
      require_kemerbet_v1_retirement_expiry_guard_armed ||
        die 'fresh-host startup requires an exact active expiry guard'
      if [[ "$successor_start_state" != 'absent' ]]; then
        require_kemerbet_v3_successor_armed_stopped_boundary "$commit_sha"
      else
        require_fresh_host_start_ready "$commit_sha"
      fi
      clear_bot_startup_receipt
    else
      require_private_start_cutover_ready "$commit_sha"
      inspect_kemerbet_v1_retirement_gate
      if [[ "$KEMERBET_V1_RETIREMENT_GATE_STATE" =~ \
        ^(pending|resealed-awaiting-recheck)$ ]]; then
        [[ "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" == "$commit_sha" ]] ||
          die 'the runtime recovery release does not match the v1 retirement'
        require_kemerbet_v1_retirement_reinstall_boundary resume ||
          die 'same-release core recovery requires the exact fully stopped boundary'
        kemerbet_v1_retirement_recovery_context_digest "$commit_sha" >/dev/null ||
          die 'the same-release core recovery context is unavailable'
        recovery_asset_sha256="$(kemerbet_v1_retirement_release_asset_digest \
          "$commit_sha")" || die 'the same-release core recovery assets are unavailable'
        migration_recovery_start='true'
      fi
    fi
    compose_file="$RELEASE_ROOT/$commit_sha/infra/compose.staging-beta.yaml"
    [[ ! -L "$compose_file" && "$(stat --format='%U:%G:%a' "$compose_file")" == 'root:root:444' ]] ||
      die 'the sealed Compose contract is absent or unsafe'
    for service_file in \
      owner-database-url publishable-key beta-database-url beta-transport-hmac \
      customer-web-database-url customer-web-publishable-key customer-web-rate-limit-hmac \
      bot-transport-hmac beta-payload-hmac bot-token player-action-database-url \
      api-action-transport-hmac api-action-payload-hmac api-action-capability-hmac \
      api-action-semantic-hmac cbe-deposit-reference-encryption-key \
      cbe-deposit-reference-fingerprint-key deposit-proof-reference-encryption-master \
      deposit-proof-reference-fingerprint-master bot-action-transport-hmac; do
      require_service_file "$SECRET_ROOT/$service_file"
    done
    require_immutable_config_file "$SECRET_ROOT/supabase-ca.crt"
    require_immutable_config_file "$SECRET_ROOT/cbe-deposit-reference-key-profile.v1.json"
    require_immutable_config_file "$SECRET_ROOT/deposit-proof-reference-profile.v2.json"

    for image in owner-control customer-web api beta-admission bot deposit-executor gateway; do
      [[ "$(docker_local image inspect "fetanagent-$image:$image_tag" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$commit_sha" ]] ||
        die 'an image revision does not match the reviewed commit'
    done

    require_ipv6_host_ready

    compose_environment=(
      PATH="$SAFE_PATH"
      HOME='/root'
      DOCKER_HOST="$LOCAL_DOCKER_SOCKET"
      FETANAGENT_VCS_REF="$commit_sha"
      FETANAGENT_IMAGE_TAG="$image_tag"
      FETANAGENT_STAGING_OWNER_CONTROL_DATABASE_URL_FILE="$SECRET_ROOT/owner-database-url"
      FETANAGENT_STAGING_OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE="$SECRET_ROOT/publishable-key"
      FETANAGENT_STAGING_CUSTOMER_WEB_DATABASE_URL_FILE="$SECRET_ROOT/customer-web-database-url"
      FETANAGENT_STAGING_CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE="$SECRET_ROOT/customer-web-publishable-key"
      FETANAGENT_STAGING_CUSTOMER_WEB_RATE_LIMIT_HMAC_FILE="$SECRET_ROOT/customer-web-rate-limit-hmac"
      FETANAGENT_STAGING_BETA_ADMISSION_DATABASE_URL_FILE="$SECRET_ROOT/beta-database-url"
      FETANAGENT_STAGING_BETA_ADMISSION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/beta-transport-hmac"
      FETANAGENT_STAGING_BETA_ADMISSION_PAYLOAD_HMAC_FILE="$SECRET_ROOT/beta-payload-hmac"
      FETANAGENT_STAGING_PLAYER_ACTION_DATABASE_URL_FILE="$SECRET_ROOT/player-action-database-url"
      FETANAGENT_STAGING_API_PLAYER_ACTION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/api-action-transport-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_PAYLOAD_HMAC_FILE="$SECRET_ROOT/api-action-payload-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_CAPABILITY_HMAC_FILE="$SECRET_ROOT/api-action-capability-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_SEMANTIC_HMAC_FILE="$SECRET_ROOT/api-action-semantic-hmac"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_ENCRYPTION_KEY_FILE="$SECRET_ROOT/cbe-deposit-reference-encryption-key"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_FINGERPRINT_KEY_FILE="$SECRET_ROOT/cbe-deposit-reference-fingerprint-key"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE="$SECRET_ROOT/cbe-deposit-reference-key-profile.v1.json"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_FILE="$SECRET_ROOT/deposit-proof-reference-encryption-master"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_FILE="$SECRET_ROOT/deposit-proof-reference-fingerprint-master"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_PROFILE_FILE="$SECRET_ROOT/deposit-proof-reference-profile.v2.json"
      FETANAGENT_STAGING_SUPABASE_CA_CERTIFICATE_FILE="$SECRET_ROOT/supabase-ca.crt"
      FETANAGENT_STAGING_BOT_TOKEN_FILE="$SECRET_ROOT/bot-token"
      FETANAGENT_STAGING_BOT_TRANSPORT_HMAC_FILE="$SECRET_ROOT/bot-transport-hmac"
      FETANAGENT_STAGING_BOT_PLAYER_ACTION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/bot-action-transport-hmac"
    )
    compose_command=(
      docker --host "$LOCAL_DOCKER_SOCKET" compose --env-file /dev/null
      --project-name "$PROJECT_NAME" --profile staging-manual -f "$compose_file"
    )
    # Docker may not create this bind source. Its root-owned inode is the
    # aggregate receipt authority and must exist before every Compose preflight.
    ensure_owner_kemerbet_receipt_root

    run_bounded_database_preflight() {
      local service="$1"
      local preflight_cli="$2"
      local attempt

      for attempt in 1 2 3; do
        if env -i "${compose_environment[@]}" "${compose_command[@]}" \
          run --rm --no-deps "$service" node "$preflight_cli"; then
          return 0
        fi
        if [[ "$attempt" -lt 3 ]]; then
          printf '%s database preflight attempt %s failed; waiting before bounded retry.\n' \
            "$service" "$attempt" >&2
          sleep 15
        fi
      done
      return 1
    }

    run_bounded_database_preflight \
      owner-control apps/admin/dist/database-preflight-cli.js ||
      die 'the Owner-control database preflight failed after three bounded attempts'
    run_bounded_database_preflight \
      customer-web apps/customer-web/dist/database-preflight-cli.js ||
      die 'the customer-web database preflight failed after three bounded attempts'
    run_bounded_database_preflight \
      api apps/api/dist/player-action-database-preflight-cli.js ||
      die 'the Player-ID action database preflight failed after three bounded attempts'
    run_bounded_database_preflight \
      beta-admission apps/beta-admission/dist/catalog-preflight-cli.js ||
      die 'the beta-admission database preflight failed after three bounded attempts'
    if [[ "$command" == 'fresh-start' || "$migration_recovery_start" == 'true' ]]; then
      # Fresh-host staging remains Telegram-disabled until its separately approved
      # token and end-to-end smoke gate are complete. The historical start path
      # retains the reviewed full beta profile behavior.
      env -i "${compose_environment[@]}" "${compose_command[@]}" \
        up -d --no-build --wait --wait-timeout 90 owner-control customer-web api beta-admission
    else
      env -i "${compose_environment[@]}" "${compose_command[@]}" \
        up -d --no-build --wait --wait-timeout 90
    fi
    require_owner_kemerbet_receipt_service_access
    if [[ "$successor_start_state" != 'absent' ]]; then
      require_kemerbet_v1_retirement_expiry_guard_armed ||
        die 'the KemerBet v3 successor expiry guard changed during core startup'
      require_exact_fresh_private_runtime "$commit_sha"
      inspect_kemerbet_v2_v3_successor_gate
      [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == "$successor_start_state" &&
        "$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$successor_start_release" &&
        "$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256" == "$successor_start_helper_sha" &&
        "$KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE" == 'active' &&
        "$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE" == "$successor_start_bridge_release" ]] ||
        die 'core startup changed the historical KemerBet overlay or runtime bridge'
    fi
    if [[ "$migration_recovery_start" == 'true' ]]; then
      require_exact_fresh_private_runtime "$commit_sha"
      require_kemerbet_v1_retirement_expiry_guard_disarmed ||
        die 'the migration recovery expiry guard changed during core startup'
      require_kemerbet_v1_retirement_current_context "$commit_sha" ||
        die 'the v1 retirement context changed during core startup'
      [[ "$(kemerbet_v1_retirement_release_asset_digest "$commit_sha")" == \
          "$recovery_asset_sha256" &&
        ! -e "$BOT_STARTUP_RECEIPT" && ! -L "$BOT_STARTUP_RECEIPT" &&
        ! -e "$BOT_STARTUP_RECEIPT_ROOT" && ! -L "$BOT_STARTUP_RECEIPT_ROOT" ]] ||
        die 'the same-release recovery assets or Telegram receipt changed during core startup'
    fi
    ;;

  bot-disabled-ready)
    [[ $# -eq 2 ]] || die 'bot-disabled-ready requires one reviewed main commit'
    require_fresh_bot_disabled_ready "$2"
    ;;

  install-bot-token)
    [[ $# -eq 3 ]] || die 'install-bot-token requires one reviewed main commit and one incoming file'
    commit_sha="$2"
    incoming="$3"
    [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
      die 'the reviewed main commit must be 40 lowercase hexadecimal characters'
    [[ "$incoming" == "/tmp/fetanagent-bot-token-$commit_sha" ]] ||
      die 'the incoming Telegram token path is outside the approved boundary'
    require_fresh_bot_disabled_ready "$commit_sha"
    if [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" != 'absent' ]]; then
      require_kemerbet_v3_runtime_bridge
    fi
    bot_token_successor_state="$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE"
    bot_token_successor_release="$KEMERBET_V2_V3_SUCCESSOR_RELEASE"
    bot_token_successor_helper_sha="$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256"
    bot_token_bridge_release="$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE"
    [[ ! -L "$incoming" && -f "$incoming" ]] ||
      die 'the incoming Telegram token is absent or symbolic'
    [[ "$(stat --format='%U:%a' "$incoming")" == "$EXPECTED_SUDO_USER:600" ]] ||
      die 'the incoming Telegram token ownership or mode is unsafe'
    [[ "$(wc -c <"$incoming")" -le 128 ]] || die 'the incoming Telegram token is too large'
    [[ "$(awk 'END { print NR + 0 }' "$incoming")" == '1' ]] ||
      die 'the incoming Telegram token must contain exactly one line'
    grep -Eq '^[0-9]{8,12}:[A-Za-z0-9_-]{35,}$' "$incoming" ||
      die 'the incoming Telegram token shape is invalid'
    grep -q $'\r' "$incoming" && die 'the incoming Telegram token contains a carriage return'
    install -o 10001 -g 10001 -m 0400 "$incoming" "$SECRET_ROOT/bot-token"
    rm -f -- "$incoming"
    require_service_file "$SECRET_ROOT/bot-token"
    if [[ "$bot_token_successor_state" != 'absent' ]]; then
      inspect_kemerbet_v2_v3_successor_gate
      [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == "$bot_token_successor_state" &&
        "$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$bot_token_successor_release" &&
        "$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256" == "$bot_token_successor_helper_sha" &&
        "$KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE" == 'active' &&
        "$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE" == "$bot_token_bridge_release" ]] ||
        die 'Telegram token installation changed the historical KemerBet overlay or runtime bridge'
    fi
    ;;

  start-bot)
    [[ $# -eq 3 ]] || die 'start-bot requires one reviewed main commit and image tag'
    commit_sha="$2"
    image_tag="$3"
    validate_commit_and_tag "$commit_sha" "$image_tag"
    require_exact_fresh_private_runtime "$commit_sha"
    require_service_file "$SECRET_ROOT/bot-token"
    grep -Eq '^[0-9]{8,12}:[A-Za-z0-9_-]{35,}$' "$SECRET_ROOT/bot-token" ||
      die 'the installed Telegram token shape is invalid'
    [[ "$(docker_local image inspect "fetanagent-bot:$image_tag" \
      --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$commit_sha" ]] ||
      die 'the Telegram bot image does not match the reviewed commit'
    if [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" != 'absent' ]]; then
      require_kemerbet_v3_runtime_bridge
    fi
    bot_start_successor_state="$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE"
    bot_start_successor_release="$KEMERBET_V2_V3_SUCCESSOR_RELEASE"
    bot_start_successor_helper_sha="$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256"
    bot_start_bridge_release="$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE"

    compose_file="$RELEASE_ROOT/$commit_sha/infra/compose.staging-beta.yaml"
    [[ ! -L "$compose_file" && "$(stat --format='%U:%G:%a' "$compose_file")" == 'root:root:444' ]] ||
      die 'the sealed Compose contract is absent or unsafe'
    compose_environment=(
      PATH="$SAFE_PATH"
      HOME='/root'
      DOCKER_HOST="$LOCAL_DOCKER_SOCKET"
      FETANAGENT_VCS_REF="$commit_sha"
      FETANAGENT_IMAGE_TAG="$image_tag"
      FETANAGENT_STAGING_OWNER_CONTROL_DATABASE_URL_FILE="$SECRET_ROOT/owner-database-url"
      FETANAGENT_STAGING_OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE="$SECRET_ROOT/publishable-key"
      FETANAGENT_STAGING_CUSTOMER_WEB_DATABASE_URL_FILE="$SECRET_ROOT/customer-web-database-url"
      FETANAGENT_STAGING_CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE="$SECRET_ROOT/customer-web-publishable-key"
      FETANAGENT_STAGING_CUSTOMER_WEB_RATE_LIMIT_HMAC_FILE="$SECRET_ROOT/customer-web-rate-limit-hmac"
      FETANAGENT_STAGING_BETA_ADMISSION_DATABASE_URL_FILE="$SECRET_ROOT/beta-database-url"
      FETANAGENT_STAGING_BETA_ADMISSION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/beta-transport-hmac"
      FETANAGENT_STAGING_BETA_ADMISSION_PAYLOAD_HMAC_FILE="$SECRET_ROOT/beta-payload-hmac"
      FETANAGENT_STAGING_PLAYER_ACTION_DATABASE_URL_FILE="$SECRET_ROOT/player-action-database-url"
      FETANAGENT_STAGING_API_PLAYER_ACTION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/api-action-transport-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_PAYLOAD_HMAC_FILE="$SECRET_ROOT/api-action-payload-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_CAPABILITY_HMAC_FILE="$SECRET_ROOT/api-action-capability-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_SEMANTIC_HMAC_FILE="$SECRET_ROOT/api-action-semantic-hmac"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_ENCRYPTION_KEY_FILE="$SECRET_ROOT/cbe-deposit-reference-encryption-key"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_FINGERPRINT_KEY_FILE="$SECRET_ROOT/cbe-deposit-reference-fingerprint-key"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE="$SECRET_ROOT/cbe-deposit-reference-key-profile.v1.json"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_FILE="$SECRET_ROOT/deposit-proof-reference-encryption-master"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_FILE="$SECRET_ROOT/deposit-proof-reference-fingerprint-master"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_PROFILE_FILE="$SECRET_ROOT/deposit-proof-reference-profile.v2.json"
      FETANAGENT_STAGING_SUPABASE_CA_CERTIFICATE_FILE="$SECRET_ROOT/supabase-ca.crt"
      FETANAGENT_STAGING_BOT_TOKEN_FILE="$SECRET_ROOT/bot-token"
      FETANAGENT_STAGING_BOT_TRANSPORT_HMAC_FILE="$SECRET_ROOT/bot-transport-hmac"
      FETANAGENT_STAGING_BOT_PLAYER_ACTION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/bot-action-transport-hmac"
    )
    compose_command=(
      docker --host "$LOCAL_DOCKER_SOCKET" compose --env-file /dev/null
      --project-name "$PROJECT_NAME" --profile staging-manual -f "$compose_file"
    )
    clear_bot_startup_receipt
    env -i "${compose_environment[@]}" "${compose_command[@]}" \
      up -d --no-build --no-deps bot
    inspect_kemerbet_v1_retirement_gate
    if [[ "$KEMERBET_V1_RETIREMENT_GATE_STATE" =~ \
      ^(pending|resealed-awaiting-recheck)$ ]]; then
      [[ "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" == "$commit_sha" ]] ||
        die 'the recovered Telegram runtime does not match the v1 retirement release'
      require_kemerbet_v1_retirement_expiry_guard_armed ||
        die 'the recovery expiry guard changed during Telegram startup'
      require_exact_fresh_bot_runtime "$commit_sha" immediate-startup
      require_kemerbet_v1_retirement_current_context "$commit_sha" ||
        die 'the v1 retirement context changed during Telegram startup'
      kemerbet_v1_retirement_release_asset_digest "$commit_sha" >/dev/null ||
        die 'the same-release assets changed during Telegram startup'
    fi
    if [[ "$bot_start_successor_state" != 'absent' ]]; then
      require_exact_fresh_bot_runtime "$commit_sha" immediate-startup
      inspect_kemerbet_v2_v3_successor_gate
      [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == "$bot_start_successor_state" &&
        "$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$bot_start_successor_release" &&
        "$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256" == "$bot_start_successor_helper_sha" &&
        "$KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE" == 'active' &&
        "$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE" == "$bot_start_bridge_release" ]] ||
        die 'Telegram startup changed the historical KemerBet overlay or runtime bridge'
    fi
    ;;

  bot-ready)
    [[ $# -eq 2 ]] || die 'bot-ready requires one reviewed main commit'
    require_exact_fresh_bot_runtime "$2" immediate-startup
    if [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" != 'absent' ]]; then
      require_kemerbet_v3_runtime_bridge
    fi
    bot_ready_successor_state="$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE"
    bot_ready_successor_release="$KEMERBET_V2_V3_SUCCESSOR_RELEASE"
    bot_ready_successor_helper_sha="$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256"
    bot_ready_bridge_release="$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE"
    record_fresh_bot_startup_receipt "$2"
    require_exact_fresh_bot_runtime "$2" steady-state
    inspect_kemerbet_v1_retirement_gate
    if [[ "$KEMERBET_V1_RETIREMENT_GATE_STATE" =~ \
      ^(pending|resealed-awaiting-recheck)$ ]]; then
      [[ "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" == "$2" ]] ||
        die 'the Telegram startup receipt does not match the v1 retirement release'
      require_kemerbet_v1_retirement_expiry_guard_armed ||
        die 'the recovery expiry guard changed during Telegram attestation'
      require_kemerbet_v1_retirement_current_context "$2" ||
        die 'the v1 retirement context changed during Telegram attestation'
      kemerbet_v1_retirement_release_asset_digest "$2" >/dev/null ||
        die 'the same-release assets changed during Telegram attestation'
    fi
    if [[ "$bot_ready_successor_state" != 'absent' ]]; then
      inspect_kemerbet_v2_v3_successor_gate
      [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == "$bot_ready_successor_state" &&
        "$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$bot_ready_successor_release" &&
        "$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256" == "$bot_ready_successor_helper_sha" &&
        "$KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE" == 'active' &&
        "$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE" == "$bot_ready_bridge_release" ]] ||
        die 'Telegram readiness changed the historical KemerBet overlay or runtime bridge'
    fi
    ;;

  stop-bot)
    [[ $# -eq 2 ]] || die 'stop-bot requires one reviewed main commit'
    commit_sha="$2"
    [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
      die 'the reviewed main commit must be 40 lowercase hexadecimal characters'
    recover_kemerbet_recheck_before_teardown
    if [[ "$KEMERBET_TEARDOWN_RECOVERY_FAILED" == 'true' ]]; then
      emergency_stop_project_after_kemerbet_recovery_failure ||
        KEMERBET_EMERGENCY_TEARDOWN_FAILED='true'
      emergency_disarm_expiry_stop_after_kemerbet_recovery_failure ||
        KEMERBET_EMERGENCY_TEARDOWN_FAILED='true'
      abort_kemerbet_v1_reinstall_journal_after_full_expiry ||
        KEMERBET_EMERGENCY_TEARDOWN_FAILED='true'
      require_kemerbet_teardown_recovery_success
    fi
    inspect_kemerbet_v2_v3_successor_gate
    successor_component_stop='false'
    successor_component_stop_release=''
    successor_component_stop_state=''
    successor_component_stop_helper_sha=''
    successor_component_stop_bridge_release=''
    migration_component_stop='false'
    if [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'absent' ]]; then
      inspect_kemerbet_v1_retirement_gate
      if [[ ! "$KEMERBET_V1_RETIREMENT_GATE_STATE" =~ ^(absent|completed)$ ]]; then
        migration_component_stop='true'
      fi
    else
      case "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" in
        successor-installed|successor-completed)
          require_kemerbet_v3_runtime_bridge
          ;;
        *) die 'the Telegram component stop does not match an exact KemerBet v3 successor' ;;
      esac
      successor_component_stop='true'
      successor_component_stop_release="$KEMERBET_V2_V3_SUCCESSOR_RELEASE"
      successor_component_stop_state="$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE"
      successor_component_stop_helper_sha="$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256"
      successor_component_stop_bridge_release="$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE"
      migration_component_stop='true'
    fi
    if [[ "$migration_component_stop" == 'true' ]]; then
      session_container="$(docker_local container ls --all --quiet \
        --filter "label=com.docker.compose.project=$PROJECT_NAME" \
        --filter 'label=com.docker.compose.service=kemerbet-session-provision')" ||
        die 'the dependent private KemerBet session inventory could not be inspected'
      if [[ -n "$session_container" ]]; then
        [[ "$session_container" =~ ^[0-9a-f]{12,64}$ ]] ||
          die 'the dependent private KemerBet session inventory is ambiguous'
        require_exact_current_component_container \
          "$session_container" kemerbet-session-provision "$commit_sha"
        docker_local container stop --time 70 "$session_container" >/dev/null
        docker_local container rm "$session_container" >/dev/null
      fi
      gateway_container="$(docker_local container ls --all --quiet \
        --filter "label=com.docker.compose.project=$PROJECT_NAME" \
        --filter 'label=com.docker.compose.service=gateway')" ||
        die 'the dependent gateway inventory could not be inspected'
      if [[ -n "$gateway_container" ]]; then
        [[ "$gateway_container" =~ ^[0-9a-f]{12,64}$ ]] ||
          die 'the dependent gateway inventory is ambiguous'
        require_exact_current_component_container "$gateway_container" gateway "$commit_sha"
        docker_local container rm --force "$gateway_container" >/dev/null
      fi
    fi
    bot_container="$(docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter 'label=com.docker.compose.service=bot')"
    if [[ -n "$bot_container" ]]; then
      [[ "$bot_container" =~ ^[0-9a-f]{12,64}$ ]] ||
        die 'the Telegram bot container inventory is ambiguous'
      require_exact_current_component_container "$bot_container" bot "$commit_sha"
      docker_local container rm --force "$bot_container" >/dev/null
    fi
    clear_bot_startup_receipt
    if [[ "$migration_component_stop" == 'true' ]]; then
      project_containers="$(docker_local container ls --all --quiet \
        --filter "label=com.docker.compose.project=$PROJECT_NAME")" ||
        die 'the migration component-stop runtime could not be inspected'
      if [[ -n "$project_containers" ]]; then
        require_exact_fresh_private_runtime "$commit_sha"
      fi
      if [[ "$successor_component_stop" == 'false' &&
        "$KEMERBET_V1_RETIREMENT_GATE_STATE" =~ \
        ^(pending|resealed-awaiting-recheck)$ ]]; then
        require_kemerbet_v1_retirement_current_context "$commit_sha" ||
          die 'the v1 retirement context changed during Telegram component stop'
        kemerbet_v1_retirement_release_asset_digest "$commit_sha" >/dev/null ||
          die 'the same-release assets changed during Telegram component stop'
      fi
    else
      disabled_token="$(mktemp "$SECRET_ROOT/.bot-token-disabled.XXXXXX")"
      printf '%s\n' 'telegram-disabled-until-separate-smoke' >"$disabled_token"
      install -o 10001 -g 10001 -m 0400 "$disabled_token" "$SECRET_ROOT/bot-token"
      rm -f -- "$disabled_token"
      require_fresh_bot_disabled_ready "$commit_sha"
    fi
    if [[ "$successor_component_stop" == 'true' ]]; then
      inspect_kemerbet_v2_v3_successor_gate
      [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == "$successor_component_stop_state" &&
        "$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$successor_component_stop_release" &&
        "$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256" == "$successor_component_stop_helper_sha" &&
        "$KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE" == 'active' &&
        "$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE" == "$successor_component_stop_bridge_release" ]] ||
        die 'Telegram component stop changed the historical KemerBet overlay or runtime bridge'
    fi
    require_kemerbet_teardown_recovery_success
    ;;

  start-kemerbet-session-provision)
    [[ $# -eq 3 ]] ||
      die 'start-kemerbet-session-provision requires one reviewed main commit and image tag'
    commit_sha="$2"
    image_tag="$3"
    validate_commit_and_tag "$commit_sha" "$image_tag"
    require_exact_fresh_bot_runtime "$commit_sha" published-steady-state
    [[ "$(docker_local image inspect "fetanagent-deposit-executor:$image_tag" \
      --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$commit_sha" ]] ||
      die 'the private KemerBet session image does not match the reviewed commit'
    [[ "$(docker_local image inspect "fetanagent-deposit-executor:$image_tag" \
      --format '{{.Config.User}}')" == '10001:10001' ]] ||
      die 'the private KemerBet session image user is not exact'
    require_kemerbet_identity_key_file "$KEMERBET_AGENT_IDENTITY_HMAC_KEY"
    require_root_readable_immutable_file "$KEMERBET_AGENT_IDENTITY_BINDINGS"
    require_kemerbet_v3_binding_content "$KEMERBET_AGENT_IDENTITY_BINDINGS" ||
      die 'private KemerBet sign-in requires the exact immutable v3 identity binding'
    require_immutable_config_file "$KEMERBET_SELECTOR_CONTRACT"
    require_kemerbet_readiness_output_directory
    require_kemerbet_v3_runtime_bridge
    successor_session_state="$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE"
    successor_session_release="$KEMERBET_V2_V3_SUCCESSOR_RELEASE"
    successor_session_helper_sha="$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256"
    successor_session_bridge_release="$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE"

    compose_file="$RELEASE_ROOT/$commit_sha/infra/compose.staging-beta.yaml"
    [[ ! -L "$compose_file" && "$(stat --format='%U:%G:%a' "$compose_file")" == 'root:root:444' ]] ||
      die 'the sealed Compose contract is absent or unsafe'
    compose_environment=(
      PATH="$SAFE_PATH"
      HOME='/root'
      DOCKER_HOST="$LOCAL_DOCKER_SOCKET"
      FETANAGENT_VCS_REF="$commit_sha"
      FETANAGENT_IMAGE_TAG="$image_tag"
      FETANAGENT_STAGING_OWNER_CONTROL_DATABASE_URL_FILE="$SECRET_ROOT/owner-database-url"
      FETANAGENT_STAGING_OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE="$SECRET_ROOT/publishable-key"
      FETANAGENT_STAGING_CUSTOMER_WEB_DATABASE_URL_FILE="$SECRET_ROOT/customer-web-database-url"
      FETANAGENT_STAGING_CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE="$SECRET_ROOT/customer-web-publishable-key"
      FETANAGENT_STAGING_CUSTOMER_WEB_RATE_LIMIT_HMAC_FILE="$SECRET_ROOT/customer-web-rate-limit-hmac"
      FETANAGENT_STAGING_BETA_ADMISSION_DATABASE_URL_FILE="$SECRET_ROOT/beta-database-url"
      FETANAGENT_STAGING_BETA_ADMISSION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/beta-transport-hmac"
      FETANAGENT_STAGING_BETA_ADMISSION_PAYLOAD_HMAC_FILE="$SECRET_ROOT/beta-payload-hmac"
      FETANAGENT_STAGING_PLAYER_ACTION_DATABASE_URL_FILE="$SECRET_ROOT/player-action-database-url"
      FETANAGENT_STAGING_API_PLAYER_ACTION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/api-action-transport-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_PAYLOAD_HMAC_FILE="$SECRET_ROOT/api-action-payload-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_CAPABILITY_HMAC_FILE="$SECRET_ROOT/api-action-capability-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_SEMANTIC_HMAC_FILE="$SECRET_ROOT/api-action-semantic-hmac"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_ENCRYPTION_KEY_FILE="$SECRET_ROOT/cbe-deposit-reference-encryption-key"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_FINGERPRINT_KEY_FILE="$SECRET_ROOT/cbe-deposit-reference-fingerprint-key"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE="$SECRET_ROOT/cbe-deposit-reference-key-profile.v1.json"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_FILE="$SECRET_ROOT/deposit-proof-reference-encryption-master"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_FILE="$SECRET_ROOT/deposit-proof-reference-fingerprint-master"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_PROFILE_FILE="$SECRET_ROOT/deposit-proof-reference-profile.v2.json"
      FETANAGENT_STAGING_SUPABASE_CA_CERTIFICATE_FILE="$SECRET_ROOT/supabase-ca.crt"
      FETANAGENT_STAGING_BOT_TOKEN_FILE="$SECRET_ROOT/bot-token"
      FETANAGENT_STAGING_BOT_TRANSPORT_HMAC_FILE="$SECRET_ROOT/bot-transport-hmac"
      FETANAGENT_STAGING_BOT_PLAYER_ACTION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/bot-action-transport-hmac"
    )
    compose_command=(
      docker --host "$LOCAL_DOCKER_SOCKET" compose --env-file /dev/null
      --project-name "$PROJECT_NAME" --profile kemerbet-session-provision -f "$compose_file"
    )
    env -i "${compose_environment[@]}" "${compose_command[@]}" \
      up -d --no-build --no-deps --wait --wait-timeout 90 kemerbet-session-provision
    require_exact_fresh_bot_runtime "$commit_sha" published-with-kemerbet-session
    require_kemerbet_session_provision_runtime "$commit_sha"
    require_kemerbet_v1_retirement_expiry_guard_armed ||
      die 'the recovery expiry guard changed during private KemerBet session startup'
    inspect_kemerbet_v2_v3_successor_gate
    [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == "$successor_session_state" &&
      "$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$successor_session_release" &&
      "$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256" == "$successor_session_helper_sha" &&
      "$KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE" == 'active' &&
      "$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE" == "$successor_session_bridge_release" ]] ||
      die 'the private KemerBet session changed the immutable historical overlay or runtime bridge'
    ;;

  kemerbet-session-provision-ready)
    [[ $# -eq 2 ]] ||
      die 'kemerbet-session-provision-ready requires one reviewed main commit'
    commit_sha="$2"
    [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
      die 'the reviewed main commit must be 40 lowercase hexadecimal characters'
    require_exact_fresh_bot_runtime "$commit_sha" published-with-kemerbet-session
    require_kemerbet_session_provision_runtime "$commit_sha"
    require_kemerbet_v1_retirement_expiry_guard_armed ||
      die 'the recovery expiry guard changed before private KemerBet session attestation'
    require_kemerbet_v3_runtime_bridge
    ;;

  kemerbet-v1-retirement-recovery-ready)
    [[ $# -eq 2 ]] ||
      die 'v1 retirement recovery preflight requires one exact reviewed release'
    commit_sha="$2"
    [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
      die 'the v1 retirement recovery release must be 40 lowercase hexadecimal characters'
    require_kemerbet_v1_retirement_recovery_ready "$commit_sha" ||
      die 'the exact fully expired v1 retirement recovery boundary is not ready'
    case "$KEMERBET_V1_RETIREMENT_RECOVERY_PREFLIGHT_STATE" in
      clean)
        printf '%s\n' 'KemerBet v1 retirement recovery preflight: clean.'
        ;;
      safe-to-reset)
        printf '%s\n' 'KemerBet v1 retirement recovery preflight: safe-to-reset.'
        ;;
      *) die 'the v1 retirement recovery preflight state is invalid' ;;
    esac
    ;;

  reinstall-kemerbet-v1-retirement-secrets)
    [[ $# -eq 3 ]] ||
      die 'v1 retirement secret recovery requires one reviewed commit and one exact incoming directory'
    commit_sha="$2"
    incoming="$3"
    [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
      die 'the reviewed main commit must be 40 lowercase hexadecimal characters'
    [[ "$incoming" == "/tmp/fetanagent-kemerbet-v1-retirement-secrets-$commit_sha" ]] ||
      die 'the v1 retirement secret bundle is outside the exact recovery path'
    consumed_incoming="${incoming}.consumed"
    if [[ "$KEMERBET_V1_RETIREMENT_GATE_STATE" == 'seal-finalization-prefix' ]]; then
      finalize_kemerbet_v1_retirement_after_v2_seal "$commit_sha" ||
        die 'the offline v2 seal prefix could not be finalized before secret recovery'
      inspect_kemerbet_v1_retirement_gate
      [[ "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" == "$commit_sha" &&
        "$KEMERBET_V1_RETIREMENT_GATE_STATE" =~ \
          ^(resealed-awaiting-recheck|secrets-reinstall-residue)$ ]] ||
        die 'the offline v2 seal prefix did not reach exact resealed continuity'
    fi
    source_path=''
    source_available='false'
    partial_residue_removed='false'
    if inspect_kemerbet_v1_reinstall_residue "$commit_sha"; then
      source_path="$KEMERBET_V1_REINSTALL_RESIDUE_PATH"
      if [[ "$KEMERBET_V1_REINSTALL_RESIDUE_COMPLETE" == 'true' ]]; then
        source_available='true'
        bundle_sha256="$KEMERBET_V1_REINSTALL_RESIDUE_BUNDLE_SHA256"
      else
        kemerbet_v1_reinstall_input_residue purge "$source_path" ||
          die 'the partial consumed v1 retirement secret residue could not be purged safely'
        [[ ! -e "$incoming" && ! -L "$incoming" &&
          ! -e "$consumed_incoming" && ! -L "$consumed_incoming" ]] ||
          die 'the partial consumed v1 retirement secret residue survived its scoped purge'
        source_path=''
        partial_residue_removed='true'
      fi
    else
      residue_status=$?
      [[ "$residue_status" -eq 1 ]] ||
        die 'the v1 retirement secret input residue inventory is unsafe or ambiguous'
    fi

    require_kemerbet_v1_retirement_current_context "$commit_sha" ||
      die 'the durable v1 retirement context changed before secret recovery'
    if [[ -e "$KEMERBET_V1_RETIREMENT_ARCHIVE" ||
      -L "$KEMERBET_V1_RETIREMENT_ARCHIVE" ]]; then
      require_kemerbet_v1_retirement_archive ||
        die 'secret recovery requires the exact retired v1 archive'
    else
      require_kemerbet_v1_retirement_completed_continuity &&
        [[ "$KEMERBET_V1_RETIREMENT_CONTINUITY_STATE" == 'resealed-awaiting-recheck' ]] ||
        die 'secret recovery requires exact resealed-awaiting-recheck continuity'
    fi
    context_sha256="$(kemerbet_v1_retirement_recovery_context_digest "$commit_sha")" ||
      die 'the v1 retirement recovery context is unavailable'
    asset_sha256="$(kemerbet_v1_retirement_release_asset_digest "$commit_sha")" ||
      die 'the sealed same-release Compose and image identities are unavailable'
    [[ "$asset_sha256" == "$KEMERBET_V1_RETIREMENT_RELEASE_ASSET_SHA256" ]] ||
      die 'the sealed same-release Compose or image identity differs from the retirement intent'

    journal_present='false'
    if [[ -e "$KEMERBET_V1_REINSTALL_JOURNAL" ||
      -L "$KEMERBET_V1_REINSTALL_JOURNAL" ]]; then
      read_kemerbet_v1_reinstall_journal ||
        die 'the v1 retirement secret-recovery journal is invalid'
      journal_present='true'
    elif [[ -e "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" ||
      -L "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" ]]; then
      if read_kemerbet_v1_reinstall_journal \
        "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING"; then
        journal_present='prefix'
      else
        require_kemerbet_v1_reinstall_partial_prefix ||
          die 'the unpublished v1 retirement secret-recovery journal prefix is unsafe'
        [[ "$source_available" == 'true' ]] ||
          die 'a full exact 23-file bundle is required to recover the partial journal prefix'
        require_kemerbet_v1_retirement_reinstall_boundary initial ||
          die 'the partial journal prefix may be retired only at the exact initial boundary'
        remove_kemerbet_v1_reinstall_partial_prefix ||
          die 'the partial journal prefix could not be retired durably'
      fi
    fi
    already_complete='false'
    if [[ "$source_available" != 'true' ]]; then
      if observed_targets="$(kemerbet_v1_retirement_secret_bundle verify-targets - 2>/dev/null)"; then
        [[ "$observed_targets" =~ ^[0-9a-f]{64}$ ]] ||
          die 'the installed recovery-target digest is invalid'
        if [[ "$journal_present" != 'false' ]]; then
          bundle_sha256="$KEMERBET_V1_REINSTALL_BUNDLE_SHA256"
          [[ "$observed_targets" == "$bundle_sha256" ]] ||
            die 'the input-free recovery targets do not match the durable bundle digest'
        else
          bundle_sha256="$observed_targets"
          already_complete='true'
        fi
      else
        if [[ "$partial_residue_removed" == 'true' ]]; then
          die 'the partial input residue was purged; supply a new exact 23-file bundle before retrying recovery'
        fi
        die 'runtime-secret recovery requires a full exact bundle unless all journaled targets are already exact'
      fi
    fi

    if [[ "$journal_present" != 'false' ]]; then
      purge_kemerbet_v1_reinstall_target_temps ||
        die 'the journaled recovery target temporary files could not be normalized safely'
      require_kemerbet_v1_reinstall_target_temps_absent ||
        die 'a journaled recovery target temporary file remains after normalization'
      [[ "$KEMERBET_V1_REINSTALL_RELEASE" == "$commit_sha" &&
        "$KEMERBET_V1_REINSTALL_BUNDLE_SHA256" == "$bundle_sha256" &&
        "$KEMERBET_V1_REINSTALL_CONTEXT_SHA256" == "$context_sha256" &&
        "$KEMERBET_V1_REINSTALL_ASSET_SHA256" == "$asset_sha256" ]] ||
        die 'the retry bundle or recovery context does not match the durable journal'
      require_kemerbet_v1_retirement_reinstall_boundary resume ||
        die 'the resumed secret recovery boundary is not exact'
    elif [[ "$already_complete" == 'true' ]]; then
      require_kemerbet_v1_retirement_reinstall_boundary resume ||
        die 'the already-complete secret recovery boundary is not exact'
    elif ! require_kemerbet_v1_retirement_reinstall_boundary initial; then
      require_kemerbet_v1_retirement_reinstall_boundary resume ||
        die 'new secret recovery requires an exact stopped initial or retry boundary'
    fi

    if [[ "$already_complete" != 'true' ]]; then
      publish_kemerbet_v1_reinstall_journal \
        "$commit_sha" "$bundle_sha256" "$context_sha256" "$asset_sha256" ||
        die 'the v1 retirement secret-recovery journal could not be published durably'
      read_kemerbet_v1_reinstall_journal ||
        die 'the published v1 retirement secret-recovery journal is invalid'
      [[ "$KEMERBET_V1_REINSTALL_RELEASE" == "$commit_sha" &&
        "$KEMERBET_V1_REINSTALL_BUNDLE_SHA256" == "$bundle_sha256" &&
        "$KEMERBET_V1_REINSTALL_CONTEXT_SHA256" == "$context_sha256" &&
        "$KEMERBET_V1_REINSTALL_ASSET_SHA256" == "$asset_sha256" ]] ||
        die 'the durable v1 retirement secret-recovery journal changed unexpectedly'
      require_kemerbet_v1_retirement_reinstall_boundary resume ||
        die 'the journaled secret recovery boundary is not exact'

      if [[ "$source_available" == 'true' ]]; then
        kemerbet_v1_retirement_secret_bundle apply "$source_path" "$bundle_sha256" ||
          die 'the journaled v1 retirement secret bundle could not be installed exactly'
        [[ "$(kemerbet_v1_retirement_secret_bundle inspect "$source_path")" == \
            "$bundle_sha256" ]] ||
          die 'the v1 retirement secret bundle changed during installation'
        kemerbet_v1_retirement_secret_bundle apply "$source_path" "$bundle_sha256" ||
          die 'the installed v1 retirement secret targets failed exact re-attestation'
      fi
      [[ "$(kemerbet_v1_retirement_secret_bundle verify-targets -)" == "$bundle_sha256" ]] ||
        die 'the installed v1 retirement secret targets do not match the durable bundle digest'
      require_kemerbet_v1_retirement_reinstall_boundary resume ||
        die 'the staging boundary changed during secret recovery'
      [[ "$(kemerbet_v1_retirement_recovery_context_digest "$commit_sha")" == \
          "$context_sha256" &&
        "$(kemerbet_v1_retirement_release_asset_digest "$commit_sha")" == \
          "$asset_sha256" ]] ||
        die 'the retirement context, sealed Compose, or image identities changed during recovery'
      read_kemerbet_v1_reinstall_journal ||
        die 'the secret-recovery journal disappeared before durable completion'
      [[ "$KEMERBET_V1_REINSTALL_RELEASE" == "$commit_sha" &&
        "$KEMERBET_V1_REINSTALL_BUNDLE_SHA256" == "$bundle_sha256" &&
        "$KEMERBET_V1_REINSTALL_CONTEXT_SHA256" == "$context_sha256" &&
        "$KEMERBET_V1_REINSTALL_ASSET_SHA256" == "$asset_sha256" ]] ||
        die 'the secret-recovery journal changed before durable completion'
      remove_kemerbet_v1_reinstall_journal ||
        die 'the completed v1 retirement secret-recovery journal could not be retired durably'
      [[ ! -e "$KEMERBET_V1_REINSTALL_JOURNAL" &&
        ! -L "$KEMERBET_V1_REINSTALL_JOURNAL" &&
        ! -e "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" &&
        ! -L "$KEMERBET_V1_REINSTALL_JOURNAL_INSTALLING" ]] ||
        die 'a completed v1 retirement secret-recovery journal remains'
    fi

    if [[ "$source_available" == 'true' ]]; then
      if [[ "$source_path" == "$incoming" ]]; then
        stage_kemerbet_v1_reinstall_input_for_removal "$incoming" "$consumed_incoming" ||
          die 'the consumed v1 retirement secret bundle could not be staged atomically for removal'
        source_path="$consumed_incoming"
      fi
      kemerbet_v1_reinstall_input_residue purge "$source_path" ||
        die 'the consumed v1 retirement secret bundle could not be purged safely'
    fi
    [[ ! -e "$incoming" && ! -L "$incoming" &&
      ! -e "$consumed_incoming" && ! -L "$consumed_incoming" ]] ||
      die 'a consumed v1 retirement secret bundle remains after journal retirement'
    [[ "$(kemerbet_v1_retirement_secret_bundle verify-targets -)" == "$bundle_sha256" &&
      "$(kemerbet_v1_retirement_recovery_context_digest "$commit_sha")" == \
        "$context_sha256" &&
      "$(kemerbet_v1_retirement_release_asset_digest "$commit_sha")" == \
        "$asset_sha256" ]] ||
      die 'the exact recovery boundary changed while consuming the input bundle'
    printf '%s\n' 'Same-release staging secrets restored from the exact journaled recovery bundle.'
    ;;

  retire-kemerbet-readiness-binding-v1-for-v2-reseal)
    [[ $# -eq 4 ]] ||
      die 'v1 retirement requires a reviewed commit, expected v1 SHA-256, and exact confirmation'
    commit_sha="$2"
    expected_legacy_sha256="$3"
    confirmation="$4"
    [[ "$commit_sha" =~ ^[0-9a-f]{40}$ && "$expected_legacy_sha256" =~ ^[0-9a-f]{64}$ ]] ||
      die 'the v1 retirement release or expected SHA-256 is invalid'
    [[ "$confirmation" == "$KEMERBET_V1_RETIREMENT_CONFIRMATION" ]] ||
      die 'the exact one-time v1 retirement confirmation is required'
    helper_stat="$(stat --format='%d:%i:%u:%g:%a:%h:%s:%Y' "$HELPER_PATH")" ||
      die 'the installed helper identity could not be captured for v1 retirement'
    helper_sha256="$(sha256sum -- "$HELPER_PATH" | awk '{print $1}')" ||
      die 'the installed helper digest could not be captured for v1 retirement'
    [[ "$helper_sha256" =~ ^[0-9a-f]{64}$ ]] ||
      die 'the installed helper digest is invalid for v1 retirement'
    release_asset_digest="$(kemerbet_v1_retirement_release_asset_digest "$commit_sha")" ||
      die 'the reviewed same-release Compose and image identities are unavailable for v1 retirement'
    project_containers="$(docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME")" ||
      die 'the staging runtime could not be inspected before v1 retirement'
    if [[ -n "$project_containers" ]]; then
      require_exact_fresh_bot_runtime "$commit_sha" published-steady-state
    else
      require_kemerbet_v1_retirement_reinstall_boundary ||
        die 'offline v1 retirement recovery requires an exact fully expired staging boundary'
    fi
    retire_kemerbet_v1_binding_for_v2_reseal \
      "$commit_sha" "$expected_legacy_sha256" "$release_asset_digest" ||
      die 'the exact v1 binding could not be retired safely for same-claim v2 reseal'
    [[ "$(stat --format='%d:%i:%u:%g:%a:%h:%s:%Y' "$HELPER_PATH")" == "$helper_stat" &&
      "$(sha256sum -- "$HELPER_PATH" | awk '{print $1}')" == "$helper_sha256" ]] ||
      die 'the installed helper changed during v1 retirement'
    [[ "$(kemerbet_v1_retirement_release_asset_digest "$commit_sha")" == \
      "$release_asset_digest" ]] ||
      die 'the reviewed same-release Compose or image identity changed during v1 retirement'
    printf '%s\n' 'KemerBet v1 binding retired for the same failed cohort; v2 reseal is required.'
    ;;

  seal-kemerbet-readiness)
    [[ $# -eq 2 ]] ||
      die 'seal-kemerbet-readiness requires one reviewed main commit'
    commit_sha="$2"
    [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
      die 'the reviewed main commit must be 40 lowercase hexadecimal characters'
    if [[ -e "$KEMERBET_READINESS_BINDING" || -L "$KEMERBET_READINESS_BINDING" ]]; then
      [[ -e "$KEMERBET_V1_RETIREMENT_ROOT" || -L "$KEMERBET_V1_RETIREMENT_ROOT" ]] ||
        die 'the one-time KemerBet readiness binding already exists'
      require_kemerbet_readiness_output_directory
      [[ "$KEMERBET_V1_RETIREMENT_GATE_STATE" =~ \
        ^(seal-finalization-prefix|resealed-awaiting-recheck)$ ]] ||
        die 'the existing v2 binding is outside an exact recoverable seal-finalization state'
      finalize_kemerbet_v1_retirement_after_v2_seal "$commit_sha" ||
        die 'the explicit v1 retirement could not be completed against the fresh v2 binding'
      require_kemerbet_v1_retirement_completed_continuity &&
        [[ "$KEMERBET_V1_RETIREMENT_CONTINUITY_STATE" == \
          'resealed-awaiting-recheck' ]] ||
        die 'the recovered v2 seal did not reach exact resealed continuity'
      printf '%s\n' 'KemerBet readiness sealed: 5 of 5 Players, Transfer disabled.'
      exit 0
    fi
    require_exact_fresh_bot_runtime "$commit_sha" published-with-kemerbet-session
    require_kemerbet_session_provision_runtime "$commit_sha"
    owner_container="$(docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter 'label=com.docker.compose.service=owner-control')"
    [[ "$owner_container" =~ ^[0-9a-f]{12,64}$ ]] ||
      die 'the Owner container inventory is not singular for readiness sealing'
    docker_local container exec "$owner_container" node --input-type=module --eval '
      import { randomUUID } from "node:crypto";
      import http from "node:http";
      const body = JSON.stringify({ requestId: randomUUID() });
      const request = http.request({
        socketPath: "/run/fetanagent-kemerbet-session-control/session.sock",
        path: "/v1/readiness/seal",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      }, (response) => {
        let size = 0;
        const chunks = [];
        response.on("data", (chunk) => {
          size += chunk.byteLength;
          if (size > 4096) request.destroy();
          else chunks.push(chunk);
        });
        response.on("end", () => {
          try {
            const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            const keys = Object.keys(result).sort();
            const expectedKeys = [
              "currency",
              "identifiersRedacted",
              "moneyMoved",
              "playersChecked",
              "sealed",
              "transferDisabled",
            ];
            if (
              response.statusCode !== 201 ||
              keys.length !== expectedKeys.length ||
              !keys.every((key, index) => key === expectedKeys[index]) ||
              result.sealed !== true ||
              result.playersChecked !== 5 ||
              result.currency !== "ETB" ||
              result.transferDisabled !== true ||
              result.moneyMoved !== false ||
              result.identifiersRedacted !== true
            ) process.exit(31);
            process.exit(0);
          } catch {
            process.exit(32);
          }
        });
      });
      request.on("error", () => process.exit(33));
      request.setTimeout(180000, () => request.destroy());
      request.end(body);
    ' || die 'the one-time KemerBet readiness seal failed closed'
    require_kemerbet_readiness_output_directory
    [[ -f "$KEMERBET_READINESS_BINDING" && ! -L "$KEMERBET_READINESS_BINDING" ]] ||
      die 'the one-time KemerBet readiness binding was not created'
    finalize_kemerbet_v1_retirement_after_v2_seal "$commit_sha" ||
      die 'the explicit v1 retirement could not be completed against the fresh v2 binding'
    printf '%s\n' 'KemerBet readiness sealed: 5 of 5 Players, Transfer disabled.'
    ;;

  recheck-kemerbet-readiness)
    [[ $# -eq 3 ]] ||
      die 'recheck-kemerbet-readiness requires the reviewed release and image tag'
    commit_sha="$2"
    image_tag="$3"
    validate_commit_and_tag "$commit_sha" "$image_tag"
    command -v timeout >/dev/null 2>&1 || die 'the bounded execution utility is unavailable'
    command -v sync >/dev/null 2>&1 || die 'the durable synchronization utility is unavailable'
    command -v python3 >/dev/null 2>&1 || die 'the canonical artifact validator is unavailable'
    recover_incomplete_kemerbet_recheck_promotion_guarded
    inspect_kemerbet_v2_v3_successor_gate
    if [[ -e "$KEMERBET_RECHECK_RECEIPT_ROOT" || -L "$KEMERBET_RECHECK_RECEIPT_ROOT" ]]; then
      require_completed_kemerbet_recheck_for_release "$commit_sha" "$image_tag"
      if [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" != 'absent' ]]; then
        [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'successor-completed' &&
          "$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$commit_sha" ]] ||
          die 'the durable KemerBet v3 successor completion boundary is not exact'
      fi
      printf '%s\n' 'KemerBet server readiness passed: 5 of 5 Players, Transfer disabled.'
      exit 0
    fi
    [[ ! -e "$KEMERBET_RECHECK_RECEIPT_ROOT" && ! -L "$KEMERBET_RECHECK_RECEIPT_ROOT" ]] ||
      die 'the independent KemerBet readiness recheck already has a receipt'
    compose_file="$RELEASE_ROOT/$commit_sha/infra/compose.staging-beta.yaml"
    [[ ! -L "$compose_file" && "$(stat --format='%U:%G:%a' "$compose_file")" == 'root:root:444' ]] ||
      die 'the sealed Compose contract is absent or unsafe'
    [[ "$(realpath -- "$compose_file")" == "$compose_file" ]] ||
      die 'the sealed Compose contract is not canonical'
    inspect_owner_staged_kemerbet_cohort
    require_kemerbet_identity_key_file "$KEMERBET_AGENT_IDENTITY_HMAC_KEY"
    [[ "$(stat --format='%h' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")" == '1' ]] ||
      die 'the KemerBet identity key has an unsafe hard-link count'

    require_root_readable_immutable_file "$KEMERBET_SELECTOR_CONTRACT"
    selector_parent="$(dirname -- "$KEMERBET_SELECTOR_CONTRACT")"
    [[ ! -L "$selector_parent" && -d "$selector_parent" &&
      "$(realpath -- "$selector_parent")" == "$selector_parent" &&
      "$(stat --format='%U:%G' "$selector_parent")" == 'root:root' ]] ||
      die 'the KemerBet selector root is unsafe'
    selector_parent_mode="$(stat --format='%a' "$selector_parent")"
    [[ "$selector_parent_mode" =~ ^[0-7]{3,4}$ ]] || die 'the KemerBet selector root mode is invalid'
    (( (8#$selector_parent_mode & 8#022) == 0 )) ||
      die 'the KemerBet selector root is writable outside root'
    require_kemerbet_readiness_output_directory
    [[ -f "$KEMERBET_READINESS_BINDING" && ! -L "$KEMERBET_READINESS_BINDING" ]] ||
      die 'the sealed KemerBet identity binding is unavailable'
    [[ "$(stat --format='%h' "$KEMERBET_READINESS_BINDING")" == '1' ]] ||
      die 'the sealed KemerBet identity binding has an unsafe hard-link count'
    [[ ! -e "$KEMERBET_AGENT_IDENTITY_BINDINGS" && ! -L "$KEMERBET_AGENT_IDENTITY_BINDINGS" ]] ||
      die 'the fixed KemerBet identity binding already exists'
    [[ ! -e "$KEMERBET_RECHECK_CANDIDATE_ROOT" && ! -L "$KEMERBET_RECHECK_CANDIDATE_ROOT" ]] ||
      die 'a KemerBet recheck candidate boundary already exists'
    [[ -z "$(docker_local container ls --all --quiet \
      --filter "name=^/${KEMERBET_RECHECK_CONTAINER}$")" ]] ||
      die 'a KemerBet recheck container already exists'

    image_id="$(docker_local image inspect "fetanagent-deposit-executor:$image_tag" --format '{{.Id}}')" ||
      die 'the KemerBet recheck image is unavailable'
    [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || die 'the KemerBet recheck image ID is invalid'
    [[ "$(docker_local image inspect "$image_id" \
      --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}|{{ index .Config.Labels "org.opencontainers.image.title" }}|{{.Config.User}}')" == \
      "$commit_sha|fetanagent-deposit-executor|10001:10001" ]] ||
      die 'the KemerBet recheck image does not match the reviewed release'

    [[ "$(stat --format='%s' "$KEMERBET_READINESS_BINDING")" == '230' &&
      "$(wc -l <"$KEMERBET_READINESS_BINDING")" == '1' ]] ||
      die 'the sealed KemerBet identity binding shape is invalid'
    require_kemerbet_v3_binding_content "$KEMERBET_READINESS_BINDING" ||
      die 'the sealed KemerBet v3 identity binding contract is invalid'
    binding_line="$(<"$KEMERBET_READINESS_BINDING")"
    IFS=' ' read -r account_id binding_fingerprint agent_profile_pin binding_residue \
      <<<"$binding_line"
    [[ -n "$account_id" && -n "$binding_fingerprint" &&
      -n "$agent_profile_pin" && -z "$binding_residue" ]] ||
      die 'the sealed KemerBet identity binding fields are invalid'
    if [[ -e "$KEMERBET_V1_RETIREMENT_ROOT" || -L "$KEMERBET_V1_RETIREMENT_ROOT" ]]; then
      if [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'absent' ]]; then
        finalize_kemerbet_v1_retirement_after_v2_seal "$commit_sha" ||
          die 'the v1 retirement is not completed by this exact same-agent v2 binding'
      else
        [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'successor-installed' &&
          "$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$commit_sha" ]] ||
          die 'the v3 successor recheck is not bound to this exact migrated release'
      fi
    fi
    source_stat="$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_READINESS_BINDING")"
    source_dev_ino="$(stat --format='%d:%i' "$KEMERBET_READINESS_BINDING")"
    source_digest="$(sha256sum -- "$KEMERBET_READINESS_BINDING" | awk '{print $1}')"
    identity_key_dev_ino_before="$(stat --format='%d:%i' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")"
    identity_key_digest="$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')"
    selector_stat="$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_SELECTOR_CONTRACT")"
    selector_digest="$(sha256sum -- "$KEMERBET_SELECTOR_CONTRACT" | awk '{print $1}')"
    for digest in "$source_digest" "$identity_key_digest" "$selector_digest"; do
      [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || die 'a KemerBet recheck input digest is invalid'
    done

    session_container="$(docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter 'label=com.docker.compose.service=kemerbet-session-provision')" ||
      die 'the private KemerBet session inventory could not be inspected before recheck'
    journal_session_container='none'
    if [[ -n "$session_container" ]]; then
      [[ "$session_container" =~ ^[0-9a-f]{12,64}$ ]] ||
        die 'the private KemerBet session inventory is ambiguous before recheck'
      require_exact_fresh_bot_runtime "$commit_sha" published-with-kemerbet-session
      require_kemerbet_session_provision_runtime "$commit_sha"
      checkpoint_kemerbet_session_for_recheck "$session_container"
      journal_session_container="$session_container"
    else
      die 'a freshly authenticated private KemerBet session is required before recheck'
    fi

    # The provider-authenticated checkpoint terminally closes and latches the exact retained
    # browser before any retry marker, promotion journal, or exact-five cohort state can advance.
    record_kemerbet_recheck_promotion_journal \
      "$commit_sha" "$source_dev_ino" \
      "$source_digest" "$identity_key_digest" "$selector_digest" "$image_id" \
      "$journal_session_container" \
      "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" "$KEMERBET_RECHECK_OWNER_CLAIM_ID" \
      "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"
    require_kemerbet_recheck_import_prepared_promotion_journal \
      "$commit_sha" "$source_dev_ino" \
      "$source_digest" "$identity_key_digest" "$selector_digest" "$image_id" \
      "$journal_session_container" \
      "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" "$KEMERBET_RECHECK_OWNER_CLAIM_ID" \
      "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"

    KEMERBET_RECHECK_RELEASE="$commit_sha"
    KEMERBET_RECHECK_SESSION_CONTAINER="$journal_session_container"
    KEMERBET_RECHECK_SOURCE_DEV_INO="$source_dev_ino"
    KEMERBET_RECHECK_SOURCE_DIGEST="$source_digest"
    KEMERBET_RECHECK_PROMOTION_OWNED='true'
    KEMERBET_RECHECK_CLEANUP_ARMED='true'
    trap kemerbet_recheck_cleanup_trap EXIT
    trap 'kemerbet_recheck_signal_trap 130' INT
    trap 'kemerbet_recheck_signal_trap 143' TERM
    trap 'kemerbet_recheck_signal_trap 129' HUP

    owner_kemerbet_cohort_marker remove-failed "$KEMERBET_RECHECK_OWNER_CLAIM_ID" ||
      die 'the matching retryable KemerBet cohort failure marker could not be retired'
    promote_owner_staged_kemerbet_player_ids
    require_service_file "$KEMERBET_READINESS_PLAYER_IDS"
    [[ "$(stat --format='%h' "$KEMERBET_READINESS_PLAYER_IDS")" == '1' ]] ||
      die 'the one-use KemerBet Player-ID file has an unsafe hard-link count'
    KEMERBET_RECHECK_PLAYER_IDS_DEV_INO="$(stat --format='%d:%i' "$KEMERBET_READINESS_PLAYER_IDS")"
    player_ids_digest="$(sha256sum -- "$KEMERBET_READINESS_PLAYER_IDS" | awk '{print $1}')"
    [[ "$player_ids_digest" =~ ^[0-9a-f]{64}$ &&
      "$player_ids_digest" == "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" ]] ||
      die 'the KemerBet Player-ID recheck input digest is invalid'
    advance_kemerbet_recheck_import_journal_to_prepared \
      "$commit_sha" "$source_dev_ino" \
      "$source_digest" "$identity_key_digest" "$selector_digest" "$image_id" \
      "$journal_session_container" "$KEMERBET_RECHECK_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" "$KEMERBET_RECHECK_OWNER_CLAIM_ID" \
      "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"
    require_kemerbet_recheck_prepared_promotion_journal \
      "$commit_sha" "$source_dev_ino" \
      "$source_digest" "$identity_key_digest" "$selector_digest" "$image_id" \
      "$journal_session_container" "$KEMERBET_RECHECK_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" "$KEMERBET_RECHECK_OWNER_CLAIM_ID" \
      "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"
    owner_kemerbet_cohort_marker publish-imported "$KEMERBET_RECHECK_OWNER_CLAIM_ID" ||
      die 'the KemerBet cohort import marker could not be published'
    owner_kemerbet_cohort_marker require-imported "$KEMERBET_RECHECK_OWNER_CLAIM_ID" ||
      die 'the KemerBet cohort import marker is not exact'

    if [[ "$journal_session_container" != 'none' ]]; then
      docker_local container stop --time 70 "$session_container" >/dev/null
      docker_local container rm "$session_container" >/dev/null
    fi
    require_exact_fresh_bot_runtime "$commit_sha" published-steady-state
    require_kemerbet_profile_volume_holders ''

    secret_parent="$(dirname -- "$KEMERBET_AGENT_IDENTITY_BINDINGS")"
    [[ ! -L "$secret_parent" && -d "$secret_parent" &&
      "$(realpath -- "$secret_parent")" == "$secret_parent" &&
      "$(stat --format='%U:%G' "$secret_parent")" == 'root:root' ]] ||
      die 'the KemerBet executor secret root is absent, symbolic, noncanonical, or unowned'
    case "$(stat --format='%a' "$secret_parent")" in
      700) ;;
      755) chmod 0700 "$secret_parent" ;;
      *) die 'the KemerBet executor secret root mode is unsafe' ;;
    esac
    [[ "$(stat --format='%U:%G:%a' "$secret_parent")" == 'root:root:700' ]] ||
      die 'the KemerBet executor secret root could not be fixed at mode 0700'
    sync -f "$secret_parent" || die 'the KemerBet executor secret root could not be synchronized'
    harden_kemerbet_identity_key
    harden_kemerbet_player_ids_file

    identity_key_stat="$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")"
    player_ids_stat="$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_READINESS_PLAYER_IDS")"
    [[ "$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_READINESS_BINDING")" == "$source_stat" &&
      "$(sha256sum -- "$KEMERBET_READINESS_BINDING" | awk '{print $1}')" == "$source_digest" &&
      "$(stat --format='%d:%i' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")" == "$identity_key_dev_ino_before" &&
      "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" == "$identity_key_digest" &&
      "$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_SELECTOR_CONTRACT")" == "$selector_stat" &&
      "$(sha256sum -- "$KEMERBET_SELECTOR_CONTRACT" | awk '{print $1}')" == "$selector_digest" &&
      "$(stat --format='%d:%i' "$KEMERBET_READINESS_PLAYER_IDS")" == "$KEMERBET_RECHECK_PLAYER_IDS_DEV_INO" &&
      "$(sha256sum -- "$KEMERBET_READINESS_PLAYER_IDS" | awk '{print $1}')" == "$player_ids_digest" ]] ||
      die 'a KemerBet recheck input changed while the prepared journal was active'

    profile_mountpoint="$(resolve_kemerbet_profile_volume_mountpoint)" ||
      die 'the KemerBet profile volume could not be resolved before identity attestation'
    profile_identity_digest="$(kemerbet_profile_identity_digest \
      "$account_id" "$profile_mountpoint" allow-exact-stale-singletons)" ||
      die 'the KemerBet profile identity could not be attested'
    [[ "$profile_identity_digest" =~ ^[0-9a-f]{64}$ ]] ||
      die 'the KemerBet profile identity digest is invalid'

    KEMERBET_RECHECK_CANDIDATE_CREATED='true'
    install -d -o root -g root -m 0700 "$KEMERBET_RECHECK_CANDIDATE_ROOT"
    install -o root -g root -m 0444 \
      "$KEMERBET_READINESS_BINDING" "$KEMERBET_RECHECK_CANDIDATE_BINDING"
    sync -f "$KEMERBET_RECHECK_CANDIDATE_BINDING" ||
      die 'the KemerBet recheck binding candidate could not be synchronized'
    sync -f "$KEMERBET_RECHECK_CANDIDATE_ROOT" ||
      die 'the KemerBet recheck candidate directory could not be synchronized'
    require_root_readable_immutable_file "$KEMERBET_RECHECK_CANDIDATE_BINDING"
    candidate_stat="$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_RECHECK_CANDIDATE_BINDING")"
    KEMERBET_RECHECK_CANDIDATE_DEV_INO="$(stat --format='%d:%i' "$KEMERBET_RECHECK_CANDIDATE_BINDING")"
    KEMERBET_RECHECK_CANDIDATE_DIGEST="$source_digest"
    [[ "$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_READINESS_BINDING")" == "$source_stat" &&
      "$(sha256sum -- "$KEMERBET_READINESS_BINDING" | awk '{print $1}')" == "$source_digest" &&
      "$(sha256sum -- "$KEMERBET_RECHECK_CANDIDATE_BINDING" | awk '{print $1}')" == "$source_digest" ]] ||
      die 'the sealed KemerBet identity binding changed during candidate creation'

    advance_kemerbet_recheck_promotion_journal \
      "$commit_sha" "$source_dev_ino" \
      "$KEMERBET_RECHECK_CANDIDATE_DEV_INO" "$source_digest" \
      "$identity_key_digest" "$selector_digest" "$image_id" "$profile_identity_digest" \
      "$journal_session_container" "$KEMERBET_RECHECK_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" "$KEMERBET_RECHECK_OWNER_CLAIM_ID" \
      "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"
    require_kemerbet_recheck_promotion_journal \
      "$commit_sha" "$source_dev_ino" "$KEMERBET_RECHECK_CANDIDATE_DEV_INO" "$source_digest" \
      "$identity_key_digest" "$selector_digest" "$image_id" "$profile_identity_digest" \
      "$journal_session_container" "$KEMERBET_RECHECK_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" "$KEMERBET_RECHECK_OWNER_CLAIM_ID" \
      "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"

    remove_kemerbet_recheck_container || die 'stale KemerBet readiness containers or snapshot could not be removed'
    remove_kemerbet_recheck_network || die 'the stale KemerBet recheck networks could not be removed'
    remove_kemerbet_recheck_rpc_capabilities ||
      die 'stale KemerBet readiness capabilities could not be removed'
    require_kemerbet_recheck_transients_absent ||
      die 'a stale KemerBet readiness transient survived pre-clean'
    require_kemerbet_recheck_engine_boundary ||
      die 'the Docker Engine or host firewall utilities do not meet the readiness boundary'
    create_kemerbet_recheck_rpc_capabilities "$account_id" "$commit_sha" ||
      die 'the isolated KemerBet readiness capabilities could not be created'
    run_kemerbet_recheck_authorization_premint "$image_id" ||
      die 'the offline KemerBet Layer-7 authorizations could not be minted'
    prepare_kemerbet_recheck_profile_snapshot "$account_id" "$image_id" ||
      die 'the offline KemerBet profile snapshot could not be copied, verified, and handed off'
    require_kemerbet_recheck_runtime_artifacts prepared "$commit_sha" "$account_id" ||
      die 'the prepared KemerBet readiness artifacts are not exact'
    require_kemerbet_profile_volume_holders ''
    create_kemerbet_recheck_network ||
      die 'the isolated KemerBet readiness networks could not be created'
    recheck_network_identity="$(kemerbet_recheck_network_identity)" ||
      die 'the KemerBet readiness network identities could not be captured'
    compose_environment=(
      PATH="$SAFE_PATH"
      HOME='/root'
      DOCKER_HOST="$LOCAL_DOCKER_SOCKET"
      FETANAGENT_VCS_REF="$commit_sha"
      FETANAGENT_IMAGE_TAG="$image_tag"
      FETANAGENT_STAGING_OWNER_CONTROL_DATABASE_URL_FILE="$SECRET_ROOT/owner-database-url"
      FETANAGENT_STAGING_OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE="$SECRET_ROOT/publishable-key"
      FETANAGENT_STAGING_CUSTOMER_WEB_DATABASE_URL_FILE="$SECRET_ROOT/customer-web-database-url"
      FETANAGENT_STAGING_CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE="$SECRET_ROOT/customer-web-publishable-key"
      FETANAGENT_STAGING_CUSTOMER_WEB_RATE_LIMIT_HMAC_FILE="$SECRET_ROOT/customer-web-rate-limit-hmac"
      FETANAGENT_STAGING_BETA_ADMISSION_DATABASE_URL_FILE="$SECRET_ROOT/beta-database-url"
      FETANAGENT_STAGING_BETA_ADMISSION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/beta-transport-hmac"
      FETANAGENT_STAGING_BETA_ADMISSION_PAYLOAD_HMAC_FILE="$SECRET_ROOT/beta-payload-hmac"
      FETANAGENT_STAGING_PLAYER_ACTION_DATABASE_URL_FILE="$SECRET_ROOT/player-action-database-url"
      FETANAGENT_STAGING_API_PLAYER_ACTION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/api-action-transport-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_PAYLOAD_HMAC_FILE="$SECRET_ROOT/api-action-payload-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_CAPABILITY_HMAC_FILE="$SECRET_ROOT/api-action-capability-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_SEMANTIC_HMAC_FILE="$SECRET_ROOT/api-action-semantic-hmac"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_ENCRYPTION_KEY_FILE="$SECRET_ROOT/cbe-deposit-reference-encryption-key"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_FINGERPRINT_KEY_FILE="$SECRET_ROOT/cbe-deposit-reference-fingerprint-key"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE="$SECRET_ROOT/cbe-deposit-reference-key-profile.v1.json"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_FILE="$SECRET_ROOT/deposit-proof-reference-encryption-master"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_FILE="$SECRET_ROOT/deposit-proof-reference-fingerprint-master"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_PROFILE_FILE="$SECRET_ROOT/deposit-proof-reference-profile.v2.json"
      FETANAGENT_STAGING_SUPABASE_CA_CERTIFICATE_FILE="$SECRET_ROOT/supabase-ca.crt"
      FETANAGENT_STAGING_BOT_TOKEN_FILE="$SECRET_ROOT/bot-token"
      FETANAGENT_STAGING_BOT_TRANSPORT_HMAC_FILE="$SECRET_ROOT/bot-transport-hmac"
      FETANAGENT_STAGING_BOT_PLAYER_ACTION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/bot-action-transport-hmac"
    )
    compose_command=(
      docker --host "$LOCAL_DOCKER_SOCKET" compose --env-file /dev/null
      --project-name "$PROJECT_NAME" --profile kemerbet-no-transfer-readiness -f "$compose_file"
    )
    env -i "${compose_environment[@]}" "${compose_command[@]}" \
      create --no-build --no-recreate \
      kemerbet-no-transfer-readiness \
      kemerbet-readiness-browser \
      kemerbet-readiness-egress-proxy >/dev/null
    recheck_container="$(docker_local container ls --all --quiet \
      --filter "name=^/${KEMERBET_RECHECK_CONTAINER}$")" ||
      die 'the KemerBet readiness controller inventory could not be inspected'
    browser_container="$(docker_local container ls --all --quiet \
      --filter "name=^/${KEMERBET_RECHECK_BROWSER_CONTAINER}$")" ||
      die 'the KemerBet readiness browser inventory could not be inspected'
    proxy_container="$(docker_local container ls --all --quiet \
      --filter "name=^/${KEMERBET_RECHECK_PROXY_CONTAINER}$")" ||
      die 'the KemerBet readiness proxy inventory could not be inspected'
    [[ "$recheck_container" =~ ^[0-9a-f]{12,64}$ ]] ||
      die 'the KemerBet readiness controller inventory is not singular'
    [[ "$browser_container" =~ ^[0-9a-f]{12,64}$ &&
      "$proxy_container" =~ ^[0-9a-f]{12,64}$ ]] ||
      die 'the KemerBet readiness browser or proxy inventory is not singular'
    recheck_full_container_id="$(docker_local container inspect "$recheck_container" --format '{{.Id}}')" ||
      die 'the KemerBet readiness controller identity could not be captured'
    browser_full_container_id="$(docker_local container inspect "$browser_container" --format '{{.Id}}')" ||
      die 'the KemerBet readiness browser identity could not be captured'
    proxy_full_container_id="$(docker_local container inspect "$proxy_container" --format '{{.Id}}')" ||
      die 'the KemerBet readiness proxy identity could not be captured'
    [[ "$recheck_full_container_id" =~ ^[0-9a-f]{64}$ &&
      "$browser_full_container_id" =~ ^[0-9a-f]{64}$ &&
      "$proxy_full_container_id" =~ ^[0-9a-f]{64}$ ]] ||
      die 'a KemerBet readiness container identity is invalid'
    require_kemerbet_profile_volume_holders ''
    kemerbet_recheck_profile_snapshot_volume_holders_match "$browser_full_container_id" ||
      die 'the KemerBet readiness snapshot has an unexpected holder'
    require_kemerbet_recheck_container_contract \
      "$recheck_full_container_id" controller "$commit_sha" "$image_tag" "$image_id" ||
      die 'the KemerBet readiness controller contract is not exact'
    require_kemerbet_recheck_container_contract \
      "$browser_full_container_id" browser "$commit_sha" "$image_tag" "$image_id" ||
      die 'the KemerBet readiness browser contract is not exact'
    require_kemerbet_recheck_container_contract \
      "$proxy_full_container_id" proxy "$commit_sha" "$image_tag" "$image_id" ||
      die 'the KemerBet readiness proxy contract is not exact'
    [[ "$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")" == "$identity_key_stat" &&
      "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" == "$identity_key_digest" &&
      "$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_SELECTOR_CONTRACT")" == "$selector_stat" &&
      "$(sha256sum -- "$KEMERBET_SELECTOR_CONTRACT" | awk '{print $1}')" == "$selector_digest" &&
      "$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_READINESS_PLAYER_IDS")" == "$player_ids_stat" &&
      "$(sha256sum -- "$KEMERBET_READINESS_PLAYER_IDS" | awk '{print $1}')" == "$player_ids_digest" &&
      "$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_RECHECK_CANDIDATE_BINDING")" == "$candidate_stat" &&
      "$(sha256sum -- "$KEMERBET_RECHECK_CANDIDATE_BINDING" | awk '{print $1}')" == "$source_digest" ]] ||
      die 'a KemerBet recheck input changed before execution'

    docker_local container start "$proxy_full_container_id" >/dev/null 2>&1 ||
      die 'the KemerBet readiness Layer-7 proxy could not start'
    wait_for_kemerbet_recheck_service_healthy "$proxy_full_container_id" ||
      die 'the KemerBet readiness Layer-7 proxy did not become healthy'
    [[ "$(docker_local container inspect "$proxy_full_container_id" \
      --format '{{.Id}}|{{.State.Status}}|{{.State.Running}}|{{.State.Paused}}|{{.State.OOMKilled}}|{{.State.Error}}|{{.RestartCount}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')" == \
      "$proxy_full_container_id|running|true|false|false||0|healthy" ]] ||
      die 'the KemerBet readiness Layer-7 proxy state is not exact'

    docker_local container start "$browser_full_container_id" >/dev/null 2>&1 ||
      die 'the isolated KemerBet readiness browser could not start'
    [[ "$(docker_local container inspect "$browser_full_container_id" \
      --format '{{.State.Running}}|{{.State.Paused}}')" == 'true|false' ]] ||
      die 'the KemerBet readiness browser did not remain active behind its gate'
    install_kemerbet_recheck_network_firewall "$browser_full_container_id" browser ||
      die 'the KemerBet readiness browser firewall could not be installed'
    require_kemerbet_recheck_network_firewall "$browser_full_container_id" browser ||
      die 'the KemerBet readiness browser firewall is not exact'
    probe_kemerbet_recheck_denied_network "$browser_full_container_id" ||
      die 'the KemerBet readiness browser escaped its denied-network probe'
    publish_kemerbet_recheck_firewall_release browser ||
      die 'the KemerBet readiness browser firewall release could not be published'
    require_kemerbet_recheck_network_firewall "$browser_full_container_id" browser ||
      die 'the KemerBet readiness browser firewall changed at release'
    close_pinned_kemerbet_recheck_network_namespace browser ||
      die 'the pinned KemerBet readiness browser network namespace could not be released'
    wait_for_kemerbet_recheck_service_healthy "$browser_full_container_id" ||
      die 'the KemerBet readiness browser RPC did not become healthy'

    docker_local container start "$recheck_full_container_id" >/dev/null 2>&1 ||
      die 'the isolated KemerBet readiness controller could not start'
    [[ "$(docker_local container inspect "$recheck_full_container_id" \
      --format '{{.State.Running}}|{{.State.Paused}}')" == 'true|false' ]] ||
      die 'the KemerBet readiness controller did not remain active behind its gate'
    install_kemerbet_recheck_network_firewall "$recheck_full_container_id" controller ||
      die 'the KemerBet readiness controller firewall could not be installed'
    require_kemerbet_recheck_network_firewall "$recheck_full_container_id" controller ||
      die 'the KemerBet readiness controller firewall is not exact'
    probe_kemerbet_recheck_denied_network "$recheck_full_container_id" ||
      die 'the KemerBet readiness controller escaped its denied-network probe'
    publish_kemerbet_recheck_firewall_release controller ||
      die 'the KemerBet readiness controller firewall release could not be published'
    require_kemerbet_recheck_network_firewall "$recheck_full_container_id" controller ||
      die 'the KemerBet readiness controller firewall changed at release'
    close_pinned_kemerbet_recheck_network_namespace controller ||
      die 'the pinned KemerBet readiness controller network namespace could not be released'
    require_kemerbet_recheck_running_network_contract \
      "$browser_full_container_id" "$recheck_full_container_id" "$proxy_full_container_id" ||
      die 'the running KemerBet readiness network membership is not exact'
    [[ "$(kemerbet_recheck_network_identity)" == "$recheck_network_identity" ]] ||
      die 'a KemerBet readiness network identity changed before execution'
    require_kemerbet_recheck_runtime_artifacts released "$commit_sha" "$account_id" ||
      die 'the released KemerBet readiness artifacts are not exact'

    wait_kemerbet_recheck_container_exit_zero "$recheck_full_container_id" ||
      die 'the KemerBet readiness controller failed closed'
    wait_kemerbet_recheck_container_exit_zero "$browser_full_container_id" ||
      die 'the KemerBet readiness browser failed closed'
    require_kemerbet_recheck_running_network_contract \
      "$browser_full_container_id" "$recheck_full_container_id" "$proxy_full_container_id" ||
      die 'the KemerBet readiness network membership changed during execution'
    [[ "$(docker_local container inspect "$proxy_full_container_id" \
      --format '{{.State.Status}}|{{.State.Running}}|{{.State.Paused}}|{{.State.OOMKilled}}|{{.State.Error}}|{{.RestartCount}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')" == \
      'running|true|false|false||0|healthy' ]] ||
      die 'the KemerBet readiness proxy did not remain healthy until explicit shutdown'
    require_kemerbet_recheck_runtime_artifacts completed "$commit_sha" "$account_id" ||
      die 'the KemerBet readiness completion receipt is absent or invalid'
    [[ "$(kemerbet_recheck_network_identity)" == "$recheck_network_identity" ]] ||
      die 'a KemerBet readiness network identity changed during execution'
    resolve_kemerbet_recheck_profile_snapshot_mountpoint '10001:10001:700' >/dev/null ||
      die 'the KemerBet readiness profile snapshot root changed during execution'
    kemerbet_recheck_profile_snapshot_volume_holders_match "$browser_full_container_id" ||
      die 'the KemerBet readiness profile snapshot holder changed during execution'

    docker_local container stop --time 15 "$proxy_full_container_id" >/dev/null 2>&1 ||
      die 'the KemerBet readiness proxy could not stop cleanly'
    [[ "$(docker_local container inspect "$proxy_full_container_id" \
      --format '{{.State.Status}}|{{.State.ExitCode}}|{{.State.OOMKilled}}|{{.State.Error}}|{{.RestartCount}}')" == \
      'exited|0|false||0' ]] ||
      die 'the KemerBet readiness proxy exit contract is not exact'

    run_kemerbet_recheck_original_profile_verify "$account_id" "$image_id" ||
      die 'the original read-only KemerBet profile no longer matches its pre-run manifest'

    observed_profile_identity_digest="$(kemerbet_profile_identity_digest \
      "$account_id" "$profile_mountpoint" allow-exact-stale-singletons)" ||
      die 'the original KemerBet profile identity could not be re-attested'
    [[ "$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_RECHECK_CANDIDATE_BINDING")" == \
      "$candidate_stat" &&
      "$(sha256sum -- "$KEMERBET_RECHECK_CANDIDATE_BINDING" | awk '{print $1}')" == "$source_digest" &&
      "$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_READINESS_BINDING")" == "$source_stat" &&
      "$(sha256sum -- "$KEMERBET_READINESS_BINDING" | awk '{print $1}')" == "$source_digest" &&
      "$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")" == "$identity_key_stat" &&
      "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" == "$identity_key_digest" &&
      "$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_SELECTOR_CONTRACT")" == "$selector_stat" &&
      "$(sha256sum -- "$KEMERBET_SELECTOR_CONTRACT" | awk '{print $1}')" == "$selector_digest" &&
      "$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_READINESS_PLAYER_IDS")" == "$player_ids_stat" &&
      "$(sha256sum -- "$KEMERBET_READINESS_PLAYER_IDS" | awk '{print $1}')" == "$player_ids_digest" &&
      "$observed_profile_identity_digest" == "$profile_identity_digest" ]] ||
      die 'a KemerBet readiness input or original profile identity changed during execution'
    require_kemerbet_recheck_runtime_artifacts completed "$commit_sha" "$account_id" ||
      die 'the KemerBet readiness artifacts changed before cleanup'

    remove_kemerbet_recheck_container ||
      die 'the transient KemerBet readiness containers or profile snapshot could not be removed'
    remove_kemerbet_recheck_network ||
      die 'the transient KemerBet readiness networks could not be removed'
    remove_kemerbet_recheck_rpc_capabilities ||
      die 'the transient KemerBet readiness artifacts could not be removed'
    require_kemerbet_recheck_transients_absent ||
      die 'a transient KemerBet readiness artifact survived cleanup'
    require_kemerbet_profile_volume_holders ''

    [[ ! -e "$KEMERBET_AGENT_IDENTITY_BINDINGS" && ! -L "$KEMERBET_AGENT_IDENTITY_BINDINGS" ]] ||
      die 'the fixed KemerBet identity binding appeared before finalization'
    ln -- "$KEMERBET_RECHECK_CANDIDATE_BINDING" "$KEMERBET_AGENT_IDENTITY_BINDINGS" ||
      die 'the fixed KemerBet identity binding could not be installed without overwrite'
    KEMERBET_RECHECK_FINAL_INSTALLED='true'
    sync -f "$secret_parent" || die 'the fixed KemerBet identity binding directory could not be synchronized'
    require_root_readable_immutable_file "$KEMERBET_AGENT_IDENTITY_BINDINGS"
    [[ "$(stat --format='%d:%i:%h:%s' "$KEMERBET_AGENT_IDENTITY_BINDINGS")" == \
      "$KEMERBET_RECHECK_CANDIDATE_DEV_INO:2:230" &&
      "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_BINDINGS" | awk '{print $1}')" == "$source_digest" ]] ||
      die 'the fixed KemerBet identity binding is not an exact precommit hard link'
    require_kemerbet_recheck_promotion_journal \
      "$commit_sha" "$source_dev_ino" "$KEMERBET_RECHECK_CANDIDATE_DEV_INO" "$source_digest" \
      "$identity_key_digest" "$selector_digest" "$image_id" "$profile_identity_digest" \
      "$journal_session_container" "$KEMERBET_RECHECK_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" "$KEMERBET_RECHECK_OWNER_CLAIM_ID" \
      "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"
    require_precommit_kemerbet_artifact_boundary \
      "$source_dev_ino" "$KEMERBET_RECHECK_CANDIDATE_DEV_INO" "$source_digest" \
      "$KEMERBET_RECHECK_PLAYER_IDS_DEV_INO" "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"
    require_current_kemerbet_success_runtime_boundary \
      "$commit_sha" "$source_digest" "$identity_key_digest" "$selector_digest" \
      "$image_id" "$profile_identity_digest" require-absent-receipt

    KEMERBET_RECHECK_RECEIPT_OWNED='true'
    record_kemerbet_recheck_receipt \
      "$commit_sha" "$source_digest" \
      "$identity_key_digest" "$selector_digest" "$image_id" "$profile_identity_digest"
    require_kemerbet_recheck_receipt \
      "$commit_sha" "$source_digest" \
      "$identity_key_digest" "$selector_digest" "$image_id" "$profile_identity_digest"
    require_kemerbet_recheck_promotion_journal \
      "$commit_sha" "$source_dev_ino" "$KEMERBET_RECHECK_CANDIDATE_DEV_INO" "$source_digest" \
      "$identity_key_digest" "$selector_digest" "$image_id" "$profile_identity_digest" \
      "$journal_session_container" "$KEMERBET_RECHECK_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" "$KEMERBET_RECHECK_OWNER_CLAIM_ID" \
      "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"
    require_precommit_kemerbet_artifact_boundary \
      "$source_dev_ino" "$KEMERBET_RECHECK_CANDIDATE_DEV_INO" "$source_digest" \
      "$KEMERBET_RECHECK_PLAYER_IDS_DEV_INO" "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"
    require_current_kemerbet_success_runtime_boundary \
      "$commit_sha" "$source_digest" "$identity_key_digest" "$selector_digest" \
      "$image_id" "$profile_identity_digest" require-receipt
    KEMERBET_RECHECK_DURABLE_SUCCESS='true'

    consume_exact_one_use_kemerbet_file \
      "$KEMERBET_READINESS_PLAYER_IDS" "$KEMERBET_RECHECK_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" ||
      die 'the committed one-use KemerBet Player-ID file could not be removed'
    remove_kemerbet_recheck_candidate ||
      die 'the committed KemerBet recheck binding candidate could not be retired'
    KEMERBET_RECHECK_CANDIDATE_CREATED='false'
    [[ "$(stat --format='%d:%i:%h:%s' "$KEMERBET_AGENT_IDENTITY_BINDINGS")" == \
      "${KEMERBET_RECHECK_CANDIDATE_DEV_INO}:1:230" ]] ||
      die 'the committed KemerBet identity binding retains an unexpected hard link'
    consume_exact_kemerbet_binding_source "$source_dev_ino" "$source_digest" ||
      die 'the committed KemerBet binding source could not be removed'
    require_committed_kemerbet_recheck_boundary_shape
    require_current_kemerbet_success_runtime_boundary \
      "$commit_sha" "$source_digest" "$identity_key_digest" "$selector_digest" \
      "$image_id" "$profile_identity_digest" require-receipt
    [[ ! -e "$KEMERBET_READINESS_PLAYER_IDS" && ! -L "$KEMERBET_READINESS_PLAYER_IDS" &&
      ! -e "$KEMERBET_RECHECK_CANDIDATE_ROOT" && ! -L "$KEMERBET_RECHECK_CANDIDATE_ROOT" &&
      ! -e "$KEMERBET_READINESS_BINDING" && ! -L "$KEMERBET_READINESS_BINDING" ]] ||
      die 'a committed KemerBet cleanup input remains before Owner completion'
    complete_owner_staged_kemerbet_cohort ||
      die 'the completed Owner KemerBet cohort could not be finalized'
    require_completed_owner_kemerbet_cohort_marker
    require_committed_kemerbet_recheck_boundary_shape
    require_current_kemerbet_success_runtime_boundary \
      "$commit_sha" "$source_digest" "$identity_key_digest" "$selector_digest" \
      "$image_id" "$profile_identity_digest" require-receipt
    [[ ! -e "$KEMERBET_READINESS_PLAYER_IDS" && ! -L "$KEMERBET_READINESS_PLAYER_IDS" &&
      ! -e "$KEMERBET_RECHECK_CANDIDATE_ROOT" && ! -L "$KEMERBET_RECHECK_CANDIDATE_ROOT" &&
      ! -e "$KEMERBET_READINESS_BINDING" && ! -L "$KEMERBET_READINESS_BINDING" ]] ||
      die 'the completed KemerBet boundary retained a consumed input'
    remove_owned_kemerbet_recheck_promotion_root ||
      die 'the committed KemerBet promotion journal could not be retired'
    KEMERBET_RECHECK_PROMOTION_OWNED='false'
    require_completed_kemerbet_recheck_for_release "$commit_sha" "$image_tag"
    inspect_kemerbet_v2_v3_successor_gate
    if [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" != 'absent' ]]; then
      [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'successor-completed' &&
        "$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$commit_sha" ]] ||
        die 'the committed KemerBet v3 successor completion boundary is not exact'
    fi
    KEMERBET_RECHECK_COMMITTED='true'
    KEMERBET_RECHECK_CLEANUP_ARMED='false'
    trap - EXIT INT TERM HUP
    printf '%s\n' 'KemerBet server readiness passed: 5 of 5 Players, Transfer disabled.'
    ;;

  stop-kemerbet-session-provision)
    [[ $# -eq 2 ]] ||
      die 'stop-kemerbet-session-provision requires one reviewed main commit'
    commit_sha="$2"
    [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
      die 'the reviewed main commit must be 40 lowercase hexadecimal characters'
    recover_kemerbet_recheck_before_teardown
    if [[ "$KEMERBET_TEARDOWN_RECOVERY_FAILED" == 'true' ]]; then
      emergency_stop_project_after_kemerbet_recovery_failure ||
        KEMERBET_EMERGENCY_TEARDOWN_FAILED='true'
      emergency_disarm_expiry_stop_after_kemerbet_recovery_failure ||
        KEMERBET_EMERGENCY_TEARDOWN_FAILED='true'
      abort_kemerbet_v1_reinstall_journal_after_full_expiry ||
        KEMERBET_EMERGENCY_TEARDOWN_FAILED='true'
      require_kemerbet_teardown_recovery_success
    fi
    inspect_kemerbet_v2_v3_successor_gate
    session_stop_successor_release=''
    session_stop_successor_state=''
    session_stop_successor_helper_sha=''
    session_stop_bridge_release=''
    if [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" != 'absent' ]]; then
      case "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" in
        successor-installed|successor-completed)
          require_kemerbet_v3_runtime_bridge
          ;;
        *) die 'the private KemerBet session stop does not match an exact v3 successor' ;;
      esac
      session_stop_successor_release="$KEMERBET_V2_V3_SUCCESSOR_RELEASE"
      session_stop_successor_state="$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE"
      session_stop_successor_helper_sha="$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256"
      session_stop_bridge_release="$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE"
    fi
    session_container="$(docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter 'label=com.docker.compose.service=kemerbet-session-provision')"
    if [[ -n "$session_container" ]]; then
      [[ "$session_container" =~ ^[0-9a-f]{12,64}$ ]] ||
        die 'the private KemerBet session container inventory is ambiguous'
      require_exact_current_component_container \
        "$session_container" kemerbet-session-provision "$commit_sha"
      docker_local container stop --time 70 "$session_container" >/dev/null
      docker_local container rm "$session_container" >/dev/null
    fi
    require_exact_fresh_bot_runtime "$commit_sha" published-steady-state
    if [[ -n "$session_stop_successor_state" ]]; then
      inspect_kemerbet_v2_v3_successor_gate
      [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == "$session_stop_successor_state" &&
        "$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$session_stop_successor_release" &&
        "$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256" == "$session_stop_successor_helper_sha" &&
        "$KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE" == 'active' &&
        "$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE" == "$session_stop_bridge_release" ]] ||
        die 'private KemerBet session stop changed the historical overlay or runtime bridge'
    fi
    require_kemerbet_teardown_recovery_success
    ;;

  public-edge-ready|fresh-public-edge-ready)
    [[ $# -eq 2 ]] || die 'public-edge readiness requires one reviewed main commit'
    if [[ "$command" == 'fresh-public-edge-ready' ]]; then
      require_fresh_public_edge_ready "$2"
    else
      require_public_edge_ready "$2"
    fi
    ;;

  start-public-edge|start-fresh-public-edge)
    [[ $# -eq 3 ]] || die 'public-edge start requires a commit and image tag'
    commit_sha="$2"
    image_tag="$3"
    validate_commit_and_tag "$commit_sha" "$image_tag"
    compose_file="$RELEASE_ROOT/$commit_sha/infra/compose.staging-beta.yaml"
    [[ ! -L "$compose_file" && "$(stat --format='%U:%G:%a' "$compose_file")" == 'root:root:444' ]] ||
      die 'the sealed Compose contract is absent or unsafe'
    [[ "$(docker_local image inspect "fetanagent-gateway:$image_tag" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$commit_sha" ]] ||
      die 'the gateway image revision does not match the reviewed commit'
    if [[ "$command" == 'start-fresh-public-edge' ]]; then
      require_fresh_public_edge_ready "$commit_sha"
      require_exact_fresh_bot_runtime "$commit_sha" steady-state
    else
      require_public_edge_ready "$commit_sha"
      require_exact_private_runtime "$commit_sha"
    fi
    if [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" != 'absent' ]]; then
      require_kemerbet_v3_runtime_bridge
    fi
    public_edge_successor_state="$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE"
    public_edge_successor_release="$KEMERBET_V2_V3_SUCCESSOR_RELEASE"
    public_edge_successor_helper_sha="$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256"
    public_edge_bridge_release="$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE"

    [[ ! -L "$GATEWAY_STATE_ROOT" && ! -L "$GATEWAY_STATE_ROOT/data" && ! -L "$GATEWAY_STATE_ROOT/config" ]] ||
      die 'a gateway state path is a symbolic link'
    install -d -o root -g root -m 0755 "$GATEWAY_STATE_ROOT"
    install -d -o 10001 -g 10001 -m 0700 "$GATEWAY_STATE_ROOT/data" "$GATEWAY_STATE_ROOT/config"
    [[ ! -L "$GATEWAY_STATE_ROOT" && "$(stat --format='%U:%G:%a' "$GATEWAY_STATE_ROOT")" == 'root:root:755' ]] ||
      die 'the gateway state root ownership or mode is unsafe'
    for state_directory in data config; do
      [[ ! -L "$GATEWAY_STATE_ROOT/$state_directory" && "$(stat --format='%u:%g:%a' "$GATEWAY_STATE_ROOT/$state_directory")" == '10001:10001:700' ]] ||
        die 'a gateway state directory ownership or mode is unsafe'
    done

    compose_environment=(
      PATH="$SAFE_PATH"
      HOME='/root'
      DOCKER_HOST="$LOCAL_DOCKER_SOCKET"
      FETANAGENT_VCS_REF="$commit_sha"
      FETANAGENT_IMAGE_TAG="$image_tag"
      FETANAGENT_STAGING_OWNER_CONTROL_DATABASE_URL_FILE="$SECRET_ROOT/owner-database-url"
      FETANAGENT_STAGING_OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE="$SECRET_ROOT/publishable-key"
      FETANAGENT_STAGING_CUSTOMER_WEB_DATABASE_URL_FILE="$SECRET_ROOT/customer-web-database-url"
      FETANAGENT_STAGING_CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE="$SECRET_ROOT/customer-web-publishable-key"
      FETANAGENT_STAGING_CUSTOMER_WEB_RATE_LIMIT_HMAC_FILE="$SECRET_ROOT/customer-web-rate-limit-hmac"
      FETANAGENT_STAGING_BETA_ADMISSION_DATABASE_URL_FILE="$SECRET_ROOT/beta-database-url"
      FETANAGENT_STAGING_BETA_ADMISSION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/beta-transport-hmac"
      FETANAGENT_STAGING_BETA_ADMISSION_PAYLOAD_HMAC_FILE="$SECRET_ROOT/beta-payload-hmac"
      FETANAGENT_STAGING_PLAYER_ACTION_DATABASE_URL_FILE="$SECRET_ROOT/player-action-database-url"
      FETANAGENT_STAGING_API_PLAYER_ACTION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/api-action-transport-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_PAYLOAD_HMAC_FILE="$SECRET_ROOT/api-action-payload-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_CAPABILITY_HMAC_FILE="$SECRET_ROOT/api-action-capability-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_SEMANTIC_HMAC_FILE="$SECRET_ROOT/api-action-semantic-hmac"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_ENCRYPTION_KEY_FILE="$SECRET_ROOT/cbe-deposit-reference-encryption-key"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_FINGERPRINT_KEY_FILE="$SECRET_ROOT/cbe-deposit-reference-fingerprint-key"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE="$SECRET_ROOT/cbe-deposit-reference-key-profile.v1.json"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_FILE="$SECRET_ROOT/deposit-proof-reference-encryption-master"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_FILE="$SECRET_ROOT/deposit-proof-reference-fingerprint-master"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_PROFILE_FILE="$SECRET_ROOT/deposit-proof-reference-profile.v2.json"
      FETANAGENT_STAGING_SUPABASE_CA_CERTIFICATE_FILE="$SECRET_ROOT/supabase-ca.crt"
      FETANAGENT_STAGING_BOT_TOKEN_FILE="$SECRET_ROOT/bot-token"
      FETANAGENT_STAGING_BOT_TRANSPORT_HMAC_FILE="$SECRET_ROOT/bot-transport-hmac"
      FETANAGENT_STAGING_BOT_PLAYER_ACTION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/bot-action-transport-hmac"
    )
    compose_command=(
      docker --host "$LOCAL_DOCKER_SOCKET" compose --env-file /dev/null
      --project-name "$PROJECT_NAME" --profile staging-manual --profile public-domain -f "$compose_file"
    )
    if [[ "$command" == 'start-fresh-public-edge' ]]; then
      require_fresh_public_edge_ready "$commit_sha"
    else
      require_public_edge_ready "$commit_sha"
    fi
    env -i "${compose_environment[@]}" "${compose_command[@]}" \
      up -d --no-build --wait --wait-timeout 90 gateway
    inspect_kemerbet_v1_retirement_gate
    if [[ "$KEMERBET_V1_RETIREMENT_GATE_STATE" =~ \
      ^(pending|resealed-awaiting-recheck)$ ]]; then
      [[ "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" == "$commit_sha" ]] ||
        die 'the recovered public edge does not match the v1 retirement release'
      require_kemerbet_v1_retirement_expiry_guard_armed ||
        die 'the recovery expiry guard changed during public-edge startup'
      require_exact_fresh_bot_runtime "$commit_sha" published-steady-state
      require_kemerbet_v1_retirement_current_context "$commit_sha" ||
        die 'the v1 retirement context changed during public-edge startup'
      kemerbet_v1_retirement_release_asset_digest "$commit_sha" >/dev/null ||
        die 'the same-release assets changed during public-edge startup'
    fi
    if [[ "$public_edge_successor_state" != 'absent' ]]; then
      require_exact_fresh_bot_runtime "$commit_sha" published-steady-state
      inspect_kemerbet_v2_v3_successor_gate
      [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == "$public_edge_successor_state" &&
        "$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$public_edge_successor_release" &&
        "$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256" == "$public_edge_successor_helper_sha" &&
        "$KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE" == 'active' &&
        "$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE" == "$public_edge_bridge_release" ]] ||
        die 'public-edge startup changed the historical KemerBet overlay or runtime bridge'
    fi
    ;;

  stop-public-edge)
    [[ $# -eq 1 ]] || die 'stop-public-edge accepts no additional arguments'
    recover_kemerbet_recheck_before_teardown
    if [[ "$KEMERBET_TEARDOWN_RECOVERY_FAILED" == 'true' ]]; then
      emergency_stop_project_after_kemerbet_recovery_failure ||
        KEMERBET_EMERGENCY_TEARDOWN_FAILED='true'
      emergency_disarm_expiry_stop_after_kemerbet_recovery_failure ||
        KEMERBET_EMERGENCY_TEARDOWN_FAILED='true'
      abort_kemerbet_v1_reinstall_journal_after_full_expiry ||
        KEMERBET_EMERGENCY_TEARDOWN_FAILED='true'
      require_kemerbet_teardown_recovery_success
    fi
    inspect_kemerbet_v2_v3_successor_gate
    successor_component_stop='false'
    successor_component_stop_release=''
    successor_component_stop_state=''
    successor_component_stop_helper_sha=''
    successor_component_stop_bridge_release=''
    if [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'absent' ]]; then
      inspect_kemerbet_v1_retirement_gate
    else
      [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" =~ ^(successor-installed|successor-completed)$ &&
        "$KEMERBET_V2_V3_SUCCESSOR_RELEASE" =~ ^[0-9a-f]{40}$ ]] ||
        die 'the public-edge component stop does not match an exact KemerBet v3 successor'
      require_kemerbet_v3_runtime_bridge
      successor_component_stop='true'
      successor_component_stop_release="$KEMERBET_V2_V3_SUCCESSOR_RELEASE"
      successor_component_stop_state="$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE"
      successor_component_stop_helper_sha="$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256"
      successor_component_stop_bridge_release="$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE"
    fi
    if [[ "$successor_component_stop" == 'true' ||
      ! "$KEMERBET_V1_RETIREMENT_GATE_STATE" =~ ^(absent|completed)$ ]]; then
      session_container="$(docker_local container ls --all --quiet \
        --filter "label=com.docker.compose.project=$PROJECT_NAME" \
        --filter 'label=com.docker.compose.service=kemerbet-session-provision')" ||
        die 'the dependent private KemerBet session inventory could not be inspected'
      if [[ -n "$session_container" ]]; then
        [[ "$session_container" =~ ^[0-9a-f]{12,64}$ ]] ||
          die 'the dependent private KemerBet session inventory is ambiguous'
        docker_local container stop --time 70 "$session_container" >/dev/null
        docker_local container rm "$session_container" >/dev/null
      fi
    fi
    gateway_container="$(docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter 'label=com.docker.compose.service=gateway')"
    if [[ -n "$gateway_container" ]]; then
      [[ "$gateway_container" =~ ^[0-9a-f]{12,64}$ ]] || die 'the gateway container inventory is ambiguous'
      docker_local container rm --force "$gateway_container" >/dev/null
    fi
    require_kemerbet_profile_volume_holders ''
    if [[ "$successor_component_stop" == 'false' &&
      "$KEMERBET_V1_RETIREMENT_GATE_STATE" =~ \
      ^(pending|resealed-awaiting-recheck)$ ]]; then
      require_kemerbet_v1_retirement_current_context \
        "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" ||
        die 'the v1 retirement context changed during public-edge component stop'
      kemerbet_v1_retirement_release_asset_digest \
        "$KEMERBET_V1_RETIREMENT_GATE_RELEASE" >/dev/null ||
        die 'the same-release assets changed during public-edge component stop'
    fi
    if [[ "$successor_component_stop" == 'true' ]]; then
      inspect_kemerbet_v2_v3_successor_gate
      [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == "$successor_component_stop_state" &&
        "$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$successor_component_stop_release" &&
        "$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256" == "$successor_component_stop_helper_sha" &&
        "$KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE" == 'active' &&
        "$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE" == "$successor_component_stop_bridge_release" ]] ||
        die 'public-edge component stop changed the historical overlay or runtime bridge'
    fi
    require_kemerbet_teardown_recovery_success
    ;;

  diagnose-owner-startup)
    [[ $# -eq 3 ]] || die 'diagnose-owner-startup requires a commit and image tag'
    commit_sha="$2"
    image_tag="$3"
    validate_commit_and_tag "$commit_sha" "$image_tag"
    owner_container="$(docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter 'label=com.docker.compose.service=owner-control')"
    [[ "$owner_container" =~ ^[0-9a-f]{12,64}$ ]] ||
      die 'exactly one Owner-control container was not available for diagnostics'
    [[ "$(docker_local container inspect "$owner_container" \
      --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$commit_sha" ]] ||
      die 'the Owner-control diagnostic target does not match the reviewed commit'

    docker_local container inspect "$owner_container" \
      --format 'owner-control status={{.State.Status}} exit_code={{.State.ExitCode}} oom_killed={{.State.OOMKilled}}'
    printf '%s\n' 'owner-control bounded startup log follows:'
    docker_local container logs --tail 80 "$owner_container"
    ;;

  *)
    die 'expected verify, kemerbet-v3-runtime-bridge-ready, docker-storage-ready, stop, arm-expiry-stop, expiry-stop, cutover-ready, fresh-host-ready, network-ready, public-edge-ready, fresh-public-edge-ready, discard, install, start, fresh-start, bot-disabled-ready, install-bot-token, start-bot, bot-ready, stop-bot, start-kemerbet-session-provision, kemerbet-session-provision-ready, kemerbet-v1-retirement-recovery-ready, reinstall-kemerbet-v1-retirement-secrets, retire-kemerbet-readiness-binding-v1-for-v2-reseal, seal-kemerbet-readiness, recheck-kemerbet-readiness, stop-kemerbet-session-provision, start-public-edge, start-fresh-public-edge, stop-public-edge, or diagnose-owner-startup'
    ;;
esac
