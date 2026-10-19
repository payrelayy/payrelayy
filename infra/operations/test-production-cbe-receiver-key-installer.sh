#!/usr/bin/env bash
set -euo pipefail

[[ "${GITHUB_ACTIONS:-}" == true && "$(id -u)" != 0 ]] || {
  echo 'This synthetic host test runs only on an ephemeral GitHub runner.' >&2
  exit 1
}

helper='/usr/local/sbin/fetanagent-cbe-receiver-key-installer'
source_helper='infra/operations/fetanagent-cbe-receiver-key-installer.sh'
release_sha='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
revision='11111111-1111-4111-8111-111111111111'
version=3
stage='/var/lib/fetanagent/cbe-birr-receiver-key-custody-v1'
[[ ! -e "$helper" && ! -e /srv/fetanagent/production/current && ! -e "$stage/$revision-v$version" ]] || exit 1
sudo install -d -o root -g root -m 0700 /var/lib/fetanagent /var/lib/fetanagent/production
sudo install -d -o root -g root -m 0755 /srv/fetanagent/production/releases/$release_sha
printf '%s\n' "$release_sha" | sudo tee "/srv/fetanagent/production/releases/$release_sha/.release-sha" >/dev/null
sudo ln -s "/srv/fetanagent/production/releases/$release_sha" /srv/fetanagent/production/current
sudo install -o root -g root -m 0600 /dev/null /var/lib/fetanagent/production/helper.lock
sudo install -o root -g root -m 0700 "$source_helper" "$helper"
helper_sha="$(sha256sum "$source_helper" | cut -d ' ' -f 1)"
sudo "$helper" verify "$helper_sha" >/dev/null

key_hex='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
key_id="sha256:$(printf '%s' "$key_hex" | xxd -r -p | sha256sum | cut -d ' ' -f 1)"
root_fingerprint="sha256:$(printf '1%.0s' {1..64})"
second_fingerprint="sha256:$(printf '2%.0s' {1..64})"
root_profile="$(jq -cn --arg enc "$root_fingerprint" --arg fp "$second_fingerprint" \
  '{version:2,purpose:"cbe_birr_receiver_lookup",encryptionMasterFingerprint:$enc,fingerprintMasterFingerprint:$fp}')"
worker_profile="$(jq -cn --arg rev "$revision" --argjson ver "$version" --arg id "$key_id" \
  --arg enc "$root_fingerprint" --arg fp "$second_fingerprint" \
  '{version:1,providerCode:"cbe_birr",purpose:"receiver-lookup-opening",receiverRevisionId:$rev,receiverVersion:$ver,keyId:$id,rootEncryptionMasterFingerprint:$enc,rootFingerprintMasterFingerprint:$fp}')"
child_key="$(jq -cn --arg rev "$revision" --argjson ver "$version" --arg id "$key_id" --arg hex "$key_hex" \
  '{contractVersion:1,providerCode:"cbe_birr",purpose:"receiver-lookup-opening",receiverRevisionId:$rev,receiverVersion:$ver,keyId:$id,keyHex:$hex}')"
root_digest="sha256:$(printf '%s\n' "$root_profile" | sha256sum | cut -d ' ' -f 1)"
profile_digest="sha256:$(printf '%s\n' "$worker_profile" | sha256sum | cut -d ' ' -f 1)"
plan_digest="sha256:$(ROOT_DIGEST="$root_digest" PROFILE_DIGEST="$profile_digest" KEY_ID="$key_id" \
  REVISION="$revision" VERSION="$version" node -e \
  'const {createHash}=require("node:crypto");const pins={deploymentTarget:"production",receiverRevisionId:process.env.REVISION,receiverVersion:Number(process.env.VERSION),rootProfileSha256:process.env.ROOT_DIGEST,workerProfileSha256:process.env.PROFILE_DIGEST,workerKeyId:process.env.KEY_ID};process.stdout.write(createHash("sha256").update(JSON.stringify(pins)).digest("hex"))')"

args=("$helper_sha" "$release_sha" "$revision" "$version" "$root_digest" "$profile_digest" "$key_id" "$plan_digest")
sudo "$helper" preflight "${args[@]}" >/dev/null
result="$(printf '%s\n%s\n%s\n' "$root_profile" "$worker_profile" "$child_key" | sudo "$helper" stage "${args[@]}")"
[[ "$result" == 'CBE receiver key staged without worker or switch change.' ]] || exit 1
[[ "$(sudo stat -c '%u:%g:%a:%h' "$stage/$revision-v$version/receiver-child-key.v1.json")" == '10001:10001:400:1' ]] || exit 1
[[ "$(sudo stat -c '%u:%g:%a:%h' "$stage/$revision-v$version/receiver-opening-profile.v1.json")" == '0:0:444:1' ]] || exit 1
if sudo "$helper" preflight "${args[@]}" >/dev/null 2>&1; then exit 1; fi
if printf '%s\n%s\n%s\n' "$root_profile" "$worker_profile" "$child_key" |
    sudo "$helper" stage "${args[@]}" >/dev/null 2>&1; then exit 1; fi
echo 'Synthetic production CBE receiver host stage passed.'
