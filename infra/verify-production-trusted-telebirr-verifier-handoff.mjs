import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const helper = readFileSync(
  'infra/operations/fetanagent-production-trusted-telebirr-verifier-handoff.sh',
  'utf8',
);
const runbook = readFileSync('infra/production-trusted-telebirr-verifier-handoff.md', 'utf8');

assert.match(helper, /readonly RECORD="\$STATE\/active-record"/u);
assert.match(helper, /readonly MARKER="\$STATE\/image-handoff-record"/u);
assert.match(helper, /flock --nonblock 8/u);
assert.match(helper, /flock --nonblock 9/u);
assert.match(helper, /"\$\{#matches\[@\]\}" -eq 1/u);
assert.match(helper, /healthy_image "\$container" "\$old_image" && network_exact/u);
assert.match(helper, /compose_valid "\$new_image"/u);
assert.match(helper, /"\$new_image" != "\$old_image"/u);
assert.match(helper, /--force-recreate --no-build --no-deps "\$SERVICE"/u);
assert.match(helper, /compose_up "\$old_image" && wait_healthy "\$old_image" && network_exact/u);
assert.match(helper, /"\$EMERGENCY" emergency-stop/u);
assert.match(helper, /healthy_image "\$container" "\$new_image" && network_exact/u);
assert.match(helper, /a handoff was already recorded/u);
assert.match(helper, /readonly PIN_OVERRIDE="\$STATE\/device-pin-handoff-manifest\.v1\.json"/u);
assert.match(helper, /pin-preflight\|pin-handoff\|pin-status/u);
assert.match(helper, /read_image_handoff/u);
assert.match(helper, /read_pin_candidate "\$expected_pin_digest" "\$expected_device_digest"/u);
assert.match(helper, /the assignment signer pin changed/u);
assert.match(helper, /the candidate device pin is not the independently confirmed new key/u);
assert.match(helper, /"\$\(pin_mount_source "\$container"\)" == "\$original_pin_file"/u);
assert.match(helper, /"\$\(pin_mount_source "\$\(active_container\)"\)" == "\$PIN_OVERRIDE"/u);
assert.match(helper, /compose_up "\$new_image" && wait_healthy "\$new_image" && network_exact/u);
assert.match(helper, /"\$EMERGENCY" emergency-stop/u);
assert.doesNotMatch(helper, /docker compose down|docker (?:run|exec)|psql|curl|wget/u);

assert.match(runbook, /zero eligible staged observations/u);
assert.match(runbook, /no automatic retry/u);
assert.match(runbook, /old activation and credential remain unchanged/u);
assert.match(runbook, /One-use public device-pin correction/u);
assert.match(runbook, /zero active and historical loader candidates/u);
assert.match(runbook, /future releases must pin the/u);

console.log('Production verifier image handoff contract verified.');
