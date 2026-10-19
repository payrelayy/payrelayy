#!/usr/bin/env bash
set -euo pipefail

[[ "${GITHUB_ACTIONS:-}" == true && "$(id -u)" != 0 ]] || {
  echo 'This synthetic host test runs only on an ephemeral GitHub runner.' >&2
  exit 1
}

helper='/usr/local/sbin/fetanagent-cbe-reference-key-installer'
source_helper='infra/operations/fetanagent-cbe-reference-key-installer.sh'
release_sha='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
stage='/var/lib/fetanagent/cbe-birr-reference-key-custody-v1'
release="/srv/fetanagent/production/releases/$release_sha"
current='/srv/fetanagent/production/current'
[[ ! -e "$helper" && ! -e "$stage" ]] || exit 1

if [[ -e "$current" || -L "$current" ]]; then
  # Quality also runs the receiver-key host test in this ephemeral runner.
  [[ -L "$current" && "$(realpath "$current")" == "$release" &&
     "$(<"$release/.release-sha")" == "$release_sha" &&
     "$(sudo stat -c '%u:%g:%a' /var/lib/fetanagent/production)" == '0:0:700' &&
     "$(sudo stat -c '%u:%g:%a' /var/lib/fetanagent/production/helper.lock)" == '0:0:600' ]] || exit 1
else
  sudo install -d -o root -g root -m 0700 /var/lib/fetanagent /var/lib/fetanagent/production
  sudo install -d -o root -g root -m 0755 "$release"
  printf '%s\n' "$release_sha" | sudo tee "$release/.release-sha" >/dev/null
  sudo ln -s "$release" "$current"
  sudo install -o root -g root -m 0600 /dev/null /var/lib/fetanagent/production/helper.lock
fi
sudo install -o root -g root -m 0700 "$source_helper" "$helper"
helper_sha="$(sha256sum "$source_helper" | cut -d ' ' -f 1)"
sudo "$helper" verify "$helper_sha" >/dev/null

key_hex='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
key_id="sha256:$(printf '%s' "$key_hex" | xxd -r -p | sha256sum | cut -d ' ' -f 1)"
root_fingerprint="sha256:$(printf '1%.0s' {1..64})"
second_fingerprint="sha256:$(printf '2%.0s' {1..64})"
root_profile="$(jq -cn --arg enc "$root_fingerprint" --arg fp "$second_fingerprint" \
  '{encryptionMasterFingerprint:$enc,fingerprintMasterFingerprint:$fp,version:2}')"
worker_profile="$(jq -cn --arg id "$key_id" --arg enc "$root_fingerprint" --arg fp "$second_fingerprint" \
  '{version:1,providerCode:"cbe_birr",purpose:"deposit-proof-reference-opening",sourceProfile:"cbe_birr_official_receipt_lookup_v1",ciphertextProfileVersion:2,encryptionKeyVersion:2,keyId:$id,rootEncryptionMasterFingerprint:$enc,rootFingerprintMasterFingerprint:$fp}')"
child_key="$(jq -cn --arg id "$key_id" --arg hex "$key_hex" \
  '{contractVersion:1,providerCode:"cbe_birr",purpose:"deposit-proof-reference-opening",keyVersion:2,keyId:$id,keyHex:$hex}')"
root_digest="sha256:$(printf '%s\n' "$root_profile" | sha256sum | cut -d ' ' -f 1)"
profile_digest="sha256:$(printf '%s\n' "$worker_profile" | sha256sum | cut -d ' ' -f 1)"
plan_digest="sha256:$(jq -cn --arg root "$root_digest" --arg profile "$profile_digest" --arg key "$key_id" \
  '{deploymentTarget:"production",rootProfileSha256:$root,workerProfileSha256:$profile,workerKeyId:$key}' |
  tr -d '\n' | sha256sum | cut -d ' ' -f 1)"

args=("$helper_sha" "$release_sha" "$root_digest" "$profile_digest" "$key_id" "$plan_digest")
sudo "$helper" preflight "${args[@]}" >/dev/null
result="$(printf '%s\n%s\n%s\n' "$root_profile" "$worker_profile" "$child_key" |
  sudo "$helper" stage "${args[@]}")"
[[ "$result" == 'CBE reference key staged without worker or switch change.' ]] || exit 1
[[ "$(sudo stat -c '%u:%g:%a:%h' "$stage/${key_id#sha256:}/reference-child-key.v1.json")" == '10001:10001:400:1' ]] || exit 1
[[ "$(sudo stat -c '%u:%g:%a:%h' "$stage/${key_id#sha256:}/reference-opening-profile.v1.json")" == '0:0:444:1' ]] || exit 1
if sudo "$helper" preflight "${args[@]}" >/dev/null 2>&1; then exit 1; fi
if printf '%s\n%s\n%s\n' "$root_profile" "$worker_profile" "$child_key" |
    sudo "$helper" stage "${args[@]}" >/dev/null 2>&1; then exit 1; fi
echo 'Synthetic production CBE reference host stage passed.'
