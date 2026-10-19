#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH
umask 077

readonly SELF='/usr/local/sbin/fetanagent-cbe-receiver-key-installer'
readonly CURRENT='/srv/fetanagent/production/current'
readonly STATE='/var/lib/fetanagent/production'
readonly CUSTODY='/var/lib/fetanagent/cbe-birr-receiver-key-custody-v1'
readonly UUID='^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
readonly SHA='^[0-9a-f]{40}$'
readonly DIGEST='^sha256:[0-9a-f]{64}$'

fail() { printf 'CBE receiver key installation unavailable.\n' >&2; exit 1; }
[[ "$(id -u)" == 0 && "$#" -ge 2 ]] || fail
mode="$1"; expected_self="$2"; shift 2
[[ "$expected_self" =~ ^[0-9a-f]{64}$ ]] || fail
[[ ! -L "$SELF" && -f "$SELF" && "$(realpath -- "$SELF")" == "$SELF" ]] || fail
[[ "$(stat -c '%u:%g:%a:%h' "$SELF")" == '0:0:700:1' ]] || fail
[[ "$(sha256sum "$SELF" | cut -d ' ' -f 1)" == "$expected_self" ]] || fail
[[ "$mode" != verify || "$#" == 0 ]] || fail
if [[ "$mode" == verify ]]; then
  printf 'CBE receiver installer verified.\n'
  exit 0
fi
[[ "$mode" == preflight || "$mode" == stage ]] || fail
[[ "$#" == 7 ]] || fail
release_sha="$1"; revision="$2"; version="$3"
root_digest="$4"; profile_digest="$5"; key_id="$6"; plan_digest="$7"
[[ "$release_sha" =~ $SHA && "$revision" =~ $UUID && "$version" =~ ^[1-9][0-9]{0,9}$ ]] || fail
[[ "$root_digest" =~ $DIGEST && "$profile_digest" =~ $DIGEST && "$key_id" =~ $DIGEST && "$plan_digest" =~ $DIGEST ]] || fail
[[ -L "$CURRENT" ]] || fail
release="$(realpath -- "$CURRENT")" || fail
[[ "$release" == "/srv/fetanagent/production/releases/$release_sha" ]] || fail
[[ ! -L "$release" && -f "$release/.release-sha" && "$(<"$release/.release-sha")" == "$release_sha" ]] || fail
[[ ! -L "$STATE" && -d "$STATE" && "$(stat -c '%u:%g:%a' "$STATE")" == '0:0:700' ]] || fail
[[ ! -L /var/lib/fetanagent && -d /var/lib/fetanagent ]] || fail
[[ "$(stat -c '%u:%g:%a' /var/lib/fetanagent)" =~ ^0:0:(700|750|755)$ ]] || fail
for tool in flock head jq sha256sum sync xxd; do command -v "$tool" >/dev/null || fail; done
[[ ! -L "$CUSTODY" ]] || fail
if [[ -e "$CUSTODY" ]]; then
  [[ -d "$CUSTODY" && "$(stat -c '%u:%g:%a' "$CUSTODY")" == '0:0:700' ]] || fail
fi
target="$CUSTODY/$revision-v$version"
[[ ! -e "$target" && ! -L "$target" ]] || fail
if [[ "$mode" == preflight ]]; then
  printf 'CBE receiver key host preflight passed.\n'
  exit 0
fi

[[ ! -L "$STATE/helper.lock" && -f "$STATE/helper.lock" && "$(stat -c '%u:%g:%a' "$STATE/helper.lock")" == '0:0:600' ]] || fail
exec 9>>"$STATE/helper.lock"
flock --nonblock 9 || fail
[[ ! -e "$target" && ! -L "$target" && "$(realpath -- "$CURRENT")" == "$release" ]] || fail
if [[ ! -e "$CUSTODY" ]]; then install -d -o root -g root -m 0700 -- "$CUSTODY"; fi
[[ ! -L "$CUSTODY" && -d "$CUSTODY" && "$(stat -c '%u:%g:%a' "$CUSTODY")" == '0:0:700' ]] || fail

# The protected runner sends only three bounded, single-line canonical JSON files over SSH stdin.
# The payload is never put in an argument, environment variable, log, artifact, or release bundle.
payload="$(head -c 12289)" || fail
[[ "${#payload}" -le 12288 ]] || fail
mapfile -t lines <<<"$payload"
[[ "${#lines[@]}" == 3 ]] || fail
for line in "${lines[@]}"; do [[ "${#line}" -ge 2 && "${#line}" -le 4096 ]] || fail; done

install -d -o root -g root -m 0700 -- "$target" || fail
root_file="$target/owner-root-profile.v2.json"
profile_file="$target/receiver-opening-profile.v1.json"
key_file="$target/receiver-child-key.v1.json"
printf '%s\n' "${lines[0]}" >"$root_file"
printf '%s\n' "${lines[1]}" >"$profile_file"
printf '%s\n' "${lines[2]}" >"$key_file"
unset payload lines
chown root:root "$root_file" "$profile_file"
chmod 0444 "$root_file" "$profile_file"
chown 10001:10001 "$key_file"
chmod 0400 "$key_file"

[[ "sha256:$(sha256sum "$root_file" | cut -d ' ' -f 1)" == "$root_digest" ]] || fail
[[ "sha256:$(sha256sum "$profile_file" | cut -d ' ' -f 1)" == "$profile_digest" ]] || fail
jq -e --arg rev "$revision" --argjson ver "$version" '
  keys == ["encryptionMasterFingerprint","fingerprintMasterFingerprint","purpose","version"] and
  .version == 2 and .purpose == "cbe_birr_receiver_lookup" and
  (.encryptionMasterFingerprint | test("^sha256:[0-9a-f]{64}$")) and
  (.fingerprintMasterFingerprint | test("^sha256:[0-9a-f]{64}$"))
' "$root_file" >/dev/null 2>&1 || fail
jq -e --arg rev "$revision" --argjson ver "$version" --arg id "$key_id" '
  keys == ["keyId","providerCode","purpose","receiverRevisionId","receiverVersion","rootEncryptionMasterFingerprint","rootFingerprintMasterFingerprint","version"] and
  .version == 1 and .providerCode == "cbe_birr" and
  .purpose == "receiver-lookup-opening" and
  .receiverRevisionId == $rev and .receiverVersion == $ver and .keyId == $id
' "$profile_file" >/dev/null 2>&1 || fail
jq -e --arg rev "$revision" --argjson ver "$version" --arg id "$key_id" '
  keys == ["contractVersion","keyHex","keyId","providerCode","purpose","receiverRevisionId","receiverVersion"] and
  .contractVersion == 1 and .providerCode == "cbe_birr" and
  .purpose == "receiver-lookup-opening" and
  .receiverRevisionId == $rev and .receiverVersion == $ver and .keyId == $id and
  (.keyHex | test("^[0-9a-f]{64}$"))
' "$key_file" >/dev/null 2>&1 || fail
[[ "sha256:$(jq -r '.keyHex' "$key_file" 2>/dev/null | xxd -r -p | sha256sum | cut -d ' ' -f 1)" == "$key_id" ]] || fail
jq -e --slurpfile root "$root_file" '
  .rootEncryptionMasterFingerprint == $root[0].encryptionMasterFingerprint and
  .rootFingerprintMasterFingerprint == $root[0].fingerprintMasterFingerprint
' "$profile_file" >/dev/null 2>&1 || fail
pin_payload="$(jq -cn --arg rev "$revision" --argjson ver "$version" \
  --arg root "$root_digest" --arg profile "$profile_digest" --arg key "$key_id" \
  '{deploymentTarget:"production",receiverRevisionId:$rev,receiverVersion:$ver,rootProfileSha256:$root,workerProfileSha256:$profile,workerKeyId:$key}')" || fail
[[ "sha256:$(printf '%s' "$pin_payload" | sha256sum | cut -d ' ' -f 1)" == "$plan_digest" ]] || fail
[[ "$(stat -c '%u:%g:%a:%h' "$root_file")" == '0:0:444:1' ]] || fail
[[ "$(stat -c '%u:%g:%a:%h' "$profile_file")" == '0:0:444:1' ]] || fail
[[ "$(stat -c '%u:%g:%a:%h' "$key_file")" == '10001:10001:400:1' ]] || fail
sync -f "$root_file" "$profile_file" "$key_file" "$target"
printf 'CBE receiver key staged without worker or switch change.\n'
