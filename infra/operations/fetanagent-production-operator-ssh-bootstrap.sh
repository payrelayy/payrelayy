#!/usr/bin/env bash
# Install only the dormant, one-port SSH identity for the protected operator host.

set -euo pipefail

readonly OPERATOR_USER='fetanagent-operator'
readonly OPERATOR_HOME='/home/fetanagent-operator'
readonly PUBLIC_KEY_SOURCE='/root/fetanagent-operator.pub'
readonly AUTHORIZED_KEYS="$OPERATOR_HOME/.ssh/authorized_keys"
readonly SSHD_CONFIG='/etc/ssh/sshd_config'
readonly SSHD_BACKUP='/etc/ssh/sshd_config.fetanagent-operator.before'
readonly SSHD_INSTALLING='/etc/ssh/.sshd_config.fetanagent-operator.installing'
readonly INSTALLED_SCRIPT='/usr/local/sbin/fetanagent-production-operator-ssh-bootstrap'
readonly LOOPBACK_TARGET='127.0.0.1:743'
readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

export PATH="$SAFE_PATH"
umask 077

die() {
  printf '%s\n' "protected operator SSH bootstrap refused: $1" >&2
  exit 1
}

require_root_installer() {
  [[ $EUID -eq 0 && -z "${SUDO_USER:-}" ]] || die 'a direct root session is required'
  [[ ! -L "$INSTALLED_SCRIPT" && -f "$INSTALLED_SCRIPT" &&
    "$(realpath -- "$INSTALLED_SCRIPT")" == "$INSTALLED_SCRIPT" &&
    "$(stat --format='%u:%g:%a:%h' "$INSTALLED_SCRIPT")" == '0:0:700:1' ]] ||
    die 'the reviewed root-owned installer is not installed'
  [[ "$(realpath -- "$0")" == "$INSTALLED_SCRIPT" ]] ||
    die 'invoke only the installed root-owned installer'
  [[ ! -L /etc/ssh && -d /etc/ssh &&
    "$(stat --format='%u:%g:%a' /etc/ssh)" == '0:0:755' &&
    ! -L "$SSHD_CONFIG" && -f "$SSHD_CONFIG" &&
    "$(stat --format='%u:%g:%a:%h' "$SSHD_CONFIG")" == '0:0:644:1' ]] ||
    die 'the SSH configuration path is unsafe'
  [[ -x /usr/sbin/nologin ]] || die 'the no-login shell is unavailable'
  systemctl is-active --quiet ssh || die 'the SSH service is not active'
  sshd -t || die 'the existing SSH configuration is invalid'
}

require_public_key() {
  local line key_type key_blob key_comment
  [[ ! -L "$PUBLIC_KEY_SOURCE" && -f "$PUBLIC_KEY_SOURCE" &&
    "$(realpath -- "$PUBLIC_KEY_SOURCE")" == "$PUBLIC_KEY_SOURCE" &&
    "$(stat --format='%u:%g:%a:%h' "$PUBLIC_KEY_SOURCE")" == '0:0:600:1' ]] ||
    die 'the root-staged public key is absent or unsafe'
  [[ "$(wc -l < "$PUBLIC_KEY_SOURCE")" -eq 1 ]] || die 'the public key must have one line'
  IFS= read -r line < "$PUBLIC_KEY_SOURCE"
  [[ "$line" =~ ^ssh-ed25519\ [A-Za-z0-9+/]+={0,3}\ fetanagent-operator$ ]] ||
    die 'the public key format is unexpected'
  read -r key_type key_blob key_comment <<< "$line"
  [[ "$key_type" == 'ssh-ed25519' && "$key_comment" == "$OPERATOR_USER" ]] ||
    die 'the public key identity is unexpected'
  ssh-keygen -l -f "$PUBLIC_KEY_SOURCE" 2>/dev/null | grep -Fq '(ED25519)' ||
    die 'the public key is invalid'
  printf '%s\n' "$key_blob"
}

expected_sshd_block() {
  cat <<'CONFIG'
# BEGIN FETANAGENT PROTECTED OPERATOR (one-port, dormant)
Match User fetanagent-operator
    AuthenticationMethods publickey
    PubkeyAuthentication yes
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    PermitEmptyPasswords no
    AllowAgentForwarding no
    X11Forwarding no
    AllowTcpForwarding local
    PermitOpen 127.0.0.1:743
    PermitListen none
    AllowStreamLocalForwarding no
    PermitTTY no
    PermitUserRC no
    MaxSessions 0
    PermitTunnel no
    GatewayPorts no
    ForceCommand /usr/sbin/nologin
# END FETANAGENT PROTECTED OPERATOR
CONFIG
}

expected_authorized_keys() {
  local key_blob="$1"
  printf 'restrict,port-forwarding,permitopen="%s" ssh-ed25519 %s %s\n' \
    "$LOOPBACK_TARGET" "$key_blob" "$OPERATOR_USER"
}

require_effective_policy() {
  local policy expected config="${1:-$SSHD_CONFIG}"
  policy="$(sshd -T -f "$config" -C "user=$OPERATOR_USER,host=localhost,addr=127.0.0.1")" ||
    die 'the operator effective SSH policy cannot be read'
  for expected in \
    'authenticationmethods publickey' \
    'pubkeyauthentication yes' \
    'passwordauthentication no' \
    'kbdinteractiveauthentication no' \
    'permitemptypasswords no' \
    'allowagentforwarding no' \
    'x11forwarding no' \
    'allowtcpforwarding local' \
    'permitopen 127.0.0.1:743' \
    'permitlisten none' \
    'allowstreamlocalforwarding no' \
    'permittty no' \
    'permituserrc no' \
    'maxsessions 0' \
    'permittunnel no' \
    'gatewayports no' \
    'forcecommand /usr/sbin/nologin' \
    'permituserenvironment no' \
    'disableforwarding no'; do
    grep -Fxq -- "$expected" <<< "$policy" ||
      die 'the operator effective SSH policy is not restricted as reviewed'
  done
}

require_installed_state() {
  local key_blob shadow_password
  key_blob="$(require_public_key)"
  [[ ! -L "$SSHD_BACKUP" && -f "$SSHD_BACKUP" &&
    "$(stat --format='%u:%g:%a:%h' "$SSHD_BACKUP")" == '0:0:600:1' ]] ||
    die 'the original SSH policy backup is absent or unsafe'
  cmp -s -- "$SSHD_CONFIG" <(cat "$SSHD_BACKUP"; printf '\n'; expected_sshd_block) ||
    die 'the operator SSH policy differs from the reviewed append-only contract'
  [[ ! -e "$SSHD_INSTALLING" && ! -L "$SSHD_INSTALLING" ]] ||
    die 'an interrupted SSH policy installation remains'
  [[ "$(getent passwd "$OPERATOR_USER" | cut -d: -f6-7)" == \
    "$OPERATOR_HOME:/usr/sbin/nologin" ]] || die 'the operator account differs from the contract'
  [[ "$(id -gn "$OPERATOR_USER")" == "$OPERATOR_USER" &&
    "$(id -G "$OPERATOR_USER" | wc -w)" -eq 1 ]] ||
    die 'the operator has unexpected group access'
  shadow_password="$(getent shadow "$OPERATOR_USER" | cut -d: -f2)"
  [[ "$shadow_password" == '!'* || "$shadow_password" == '*'* ]] ||
    die 'the operator password is not locked'
  [[ ! -L "$OPERATOR_HOME" && -d "$OPERATOR_HOME" &&
    "$(stat --format='%U:%G:%a' "$OPERATOR_HOME")" == \
      "$OPERATOR_USER:$OPERATOR_USER:700" ]] || die 'the operator home is unsafe'
  [[ ! -L "$OPERATOR_HOME/.ssh" && -d "$OPERATOR_HOME/.ssh" &&
    "$(stat --format='%U:%G:%a' "$OPERATOR_HOME/.ssh")" == \
      "$OPERATOR_USER:$OPERATOR_USER:700" ]] || die 'the operator SSH directory is unsafe'
  [[ ! -L "$AUTHORIZED_KEYS" && -f "$AUTHORIZED_KEYS" &&
    "$(stat --format='%U:%G:%a:%h' "$AUTHORIZED_KEYS")" == \
      "$OPERATOR_USER:$OPERATOR_USER:600:1" ]] || die 'the operator key file is unsafe'
  cmp -s -- "$AUTHORIZED_KEYS" <(expected_authorized_keys "$key_blob") ||
    die 'the operator key does not match the reviewed one-port contract'
  sshd -t || die 'the active SSH configuration is invalid'
  require_effective_policy
}

require_absent_state() {
  ! getent passwd "$OPERATOR_USER" >/dev/null || die 'the operator account already exists'
  [[ ! -e "$OPERATOR_HOME" && ! -L "$OPERATOR_HOME" &&
    ! -e "$SSHD_BACKUP" && ! -L "$SSHD_BACKUP" &&
    ! -e "$SSHD_INSTALLING" && ! -L "$SSHD_INSTALLING" ]] ||
    die 'a partial or conflicting operator installation exists'
  ! grep -Fq '# BEGIN FETANAGENT PROTECTED OPERATOR' "$SSHD_CONFIG" ||
    die 'an operator SSH policy is already present'
  [[ -z "$(ss -H -ltn '( sport = :743 )')" ]] ||
    die 'the protected loopback target is already occupied'
}

require_root_installer
case "${1:-}" in
  inspect)
    [[ $# -eq 1 ]] || die 'inspect takes no additional arguments'
    if getent passwd "$OPERATOR_USER" >/dev/null ||
      [[ -e "$OPERATOR_HOME" || -L "$OPERATOR_HOME" ||
        -e "$SSHD_BACKUP" || -L "$SSHD_BACKUP" ]]; then
      require_installed_state
      printf '%s\n' 'The dormant one-port operator SSH identity matches the reviewed contract.'
    else
      require_absent_state
      printf '%s\n' 'The dedicated operator SSH identity is absent; no operator listener is installed.'
    fi
    ;;
  install)
    [[ $# -eq 1 ]] || die 'install takes no additional arguments'
    key_blob="$(require_public_key)"
    require_absent_state
    root_before="$(sshd -T -C 'user=root,host=localhost,addr=127.0.0.1')"
    admin_before="$(sshd -T -C 'user=fetanagent-admin,host=localhost,addr=127.0.0.1')"
    install -o root -g root -m 0600 "$SSHD_CONFIG" "$SSHD_BACKUP"
    install -o root -g root -m 0644 "$SSHD_CONFIG" "$SSHD_INSTALLING"
    { printf '\n'; expected_sshd_block; } >> "$SSHD_INSTALLING"
    cmp -s -- "$SSHD_INSTALLING" <(cat "$SSHD_BACKUP"; printf '\n'; expected_sshd_block) ||
      die 'the staged SSH policy differs from the reviewed append-only contract'
    sshd -t -f "$SSHD_INSTALLING" || die 'the staged SSH policy is invalid'
    require_effective_policy "$SSHD_INSTALLING"
    [[ "$(sshd -T -f "$SSHD_INSTALLING" -C 'user=root,host=localhost,addr=127.0.0.1')" == "$root_before" &&
      "$(sshd -T -f "$SSHD_INSTALLING" -C 'user=fetanagent-admin,host=localhost,addr=127.0.0.1')" == "$admin_before" ]] ||
      die 'the staged SSH policy changes an existing login'
    mv -- "$SSHD_INSTALLING" "$SSHD_CONFIG"
    sshd -t || die 'the installed SSH policy is invalid; no operator key was installed'
    require_effective_policy
    systemctl reload ssh || die 'the SSH policy could not be reloaded; no operator key was installed'
    require_effective_policy
    [[ "$(sshd -T -C 'user=root,host=localhost,addr=127.0.0.1')" == "$root_before" &&
      "$(sshd -T -C 'user=fetanagent-admin,host=localhost,addr=127.0.0.1')" == "$admin_before" ]] ||
      die 'the installed SSH policy changed an existing login'
    useradd --create-home --home-dir "$OPERATOR_HOME" --shell /usr/sbin/nologin \
      --user-group --password '!' "$OPERATOR_USER"
    chmod 0700 "$OPERATOR_HOME"
    install -d -o "$OPERATOR_USER" -g "$OPERATOR_USER" -m 0700 "$OPERATOR_HOME/.ssh"
    expected_authorized_keys "$key_blob" |
      install -o "$OPERATOR_USER" -g "$OPERATOR_USER" -m 0600 /dev/stdin "$AUTHORIZED_KEYS"
    require_installed_state
    printf '%s\n' 'Installed the dormant one-port operator SSH identity; no listener or financial authority was enabled.'
    ;;
  *) die 'expected inspect or install' ;;
esac
