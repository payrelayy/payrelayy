import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const [image, launcher, smoke] = await Promise.all([
  readFile(new URL('infra/Dockerfile.protected-operator-host', root), 'utf8'),
  readFile(new URL('infra/operations/fetanagent-production-operator-host-launch.sh', root), 'utf8'),
  readFile(new URL('.github/workflows/protected-operator-host-image-smoke.yml', root), 'utf8'),
]);

test('only the reviewed non-root operator binary can bind the protected port', () => {
  assert.match(image, /setcap 'cap_net_bind_service=\+ep' \/usr\/local\/bin\/node/u);
  assert.match(image, /USER 10001:10001/u);
  assert.match(
    launcher,
    /--cap-drop ALL --cap-add NET_BIND_SERVICE --security-opt no-new-privileges/u,
  );
  assert.match(launcher, /--user 10001:10001/u);
  assert.equal((launcher.match(/--cap-add /gu) ?? []).length, 1);
  assert.doesNotMatch(launcher, /--privileged\b/u);
  assert.match(smoke, /CapEff/u);
  assert.match(smoke, /CapBnd/u);
  assert.match(smoke, /--network none --read-only/u);
});
