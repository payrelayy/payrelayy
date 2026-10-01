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
assert.doesNotMatch(helper, /docker compose down|docker (?:run|exec)|psql|curl|wget/u);

assert.match(runbook, /zero eligible staged observations/u);
assert.match(runbook, /no automatic retry/u);
assert.match(runbook, /old activation and credential remain unchanged/u);

console.log('Production verifier image handoff contract verified.');
