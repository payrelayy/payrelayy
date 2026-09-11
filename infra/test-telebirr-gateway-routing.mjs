import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const gatewayImage = process.argv[2];
assert.equal(gatewayImage, 'fetanagent-gateway:ci', 'use the exact CI gateway image');
const nativeCaddy = process.env.FETANAGENT_TEST_CADDY_BINARY ?? '';
if (nativeCaddy) {
  assert.ok(path.isAbsolute(nativeCaddy), 'the local Caddy test binary path must be absolute');
} else {
  assert.equal(process.platform, 'linux', 'the container test requires Linux host networking');
}

const mediaType = 'application/vnd.fetanagent.telebirr-device-bridge+json';
const targetHeader = 'X-FetanAgent-Deployment-Target';
const routePath = '/v1/telebirr/device/heartbeat';
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(repositoryRoot, 'infra/gateway/Caddyfile'), 'utf8');
const beginMarker = '# BEGIN exact TeleBirr device routing contract';
const endMarker = '# END exact TeleBirr device routing contract';
const begin = source.indexOf(beginMarker);
const end = source.indexOf(endMarker);
assert.ok(begin >= 0 && end > begin, 'the exact TeleBirr routing block is absent');
assert.equal(source.indexOf(beginMarker, begin + 1), -1, 'the routing start marker is ambiguous');
assert.equal(source.indexOf(endMarker, end + 1), -1, 'the routing end marker is ambiguous');

const staging = await startUpstream(204);
const production = await startUpstream(202);
const gatewayPort = await reservePort();
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'fetanagent-caddy-routing-'));
await chmod(temporaryDirectory, 0o755);
const testCaddyfile = path.join(temporaryDirectory, 'Caddyfile');
const containerName = `fetanagent-caddy-routing-${process.pid}`;
let caddy;
let caddyOutput = '';

try {
  let routingBlock = source.slice(begin, end + endMarker.length);
  assert.equal(
    occurrences(routingBlock, 'staging-device-pilot-bridge:8084'),
    1,
    'the staging upstream must occur exactly once',
  );
  assert.equal(
    occurrences(routingBlock, 'telebirr-device-bridge:8084'),
    2,
    'the explicit and legacy production routes must be the only production upstreams',
  );
  routingBlock = routingBlock.replace(
    'staging-device-pilot-bridge:8084',
    `127.0.0.1:${staging.port}`,
  );
  routingBlock = routingBlock.replaceAll(
    'telebirr-device-bridge:8084',
    `127.0.0.1:${production.port}`,
  );
  await writeFile(
    testCaddyfile,
    `{
	admin off
	auto_https off
}

http://127.0.0.1:${gatewayPort} {
${routingBlock}
	respond 404
}
`,
    { encoding: 'utf8', mode: 0o444 },
  );

  const dockerArguments = [
    'run',
    '--rm',
    '--name',
    containerName,
    '--network',
    'host',
    '--read-only',
    '--tmpfs',
    '/config:rw,noexec,nosuid,nodev,size=1m,mode=1777',
    '--tmpfs',
    '/data:rw,noexec,nosuid,nodev,size=1m,mode=1777',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--mount',
    `type=bind,src=${testCaddyfile},dst=/tmp/FetanAgent.Caddyfile,readonly`,
    gatewayImage,
    'caddy',
    'run',
    '--config',
    '/tmp/FetanAgent.Caddyfile',
    '--adapter',
    'caddyfile',
  ];
  caddy = nativeCaddy
    ? spawn(nativeCaddy, ['run', '--config', testCaddyfile, '--adapter', 'caddyfile'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    : spawn('docker', dockerArguments, { stdio: ['ignore', 'pipe', 'pipe'] });
  caddy.stdout.on('data', (chunk) => {
    caddyOutput = appendBounded(caddyOutput, chunk);
  });
  caddy.stderr.on('data', (chunk) => {
    caddyOutput = appendBounded(caddyOutput, chunk);
  });
  await waitUntilReady(gatewayPort, caddy);

  await expectRoute(gatewayPort, ['staging'], 204);
  await expectRoute(gatewayPort, ['production'], 202);
  await expectRoute(gatewayPort, [], 202);
  assert.deepEqual(
    [staging.hits, production.hits],
    [1, 2],
    'exact staging, production, and header-absent legacy requests reached wrong upstreams',
  );

  for (const rejectedTarget of [
    ['preview'],
    ['Staging'],
    ['PRODUCTION'],
    [''],
    ['staging,production'],
    ['staging', 'production'],
    ['staging', 'staging'],
    ['production', 'preview'],
  ]) {
    await expectRoute(gatewayPort, rejectedTarget, 404);
    assert.deepEqual(
      [staging.hits, production.hits],
      [1, 2],
      `target values ${JSON.stringify(rejectedTarget)} reached an upstream`,
    );
  }

  await expectRoute(gatewayPort, ['production'], 404, ['Content-Type', 'application/json']);
  assert.deepEqual(
    [staging.hits, production.hits],
    [1, 2],
    'a duplicated Content-Type reached an upstream',
  );
  console.log(
    'TeleBirr Caddy routing verified: exact staging/production values, legacy absence, and fail-closed duplicate or invalid headers.',
  );
} catch (error) {
  if (caddyOutput) {
    process.stderr.write(`Caddy output:\n${caddyOutput}\n`);
  }
  throw error;
} finally {
  if (caddy && caddy.exitCode === null) {
    if (nativeCaddy) {
      caddy.kill('SIGTERM');
    } else {
      spawnSync('docker', ['stop', '--time', '2', containerName], { stdio: 'ignore' });
    }
    await Promise.race([onceExit(caddy), delay(5_000)]);
    if (caddy.exitCode === null) caddy.kill('SIGKILL');
  }
  await Promise.all([closeServer(staging.server), closeServer(production.server)]);
  await rm(temporaryDirectory, { recursive: true });
}

function occurrences(value, needle) {
  return value.split(needle).length - 1;
}

function appendBounded(current, chunk) {
  return (current + chunk.toString('utf8')).slice(-16_384);
}

async function startUpstream(statusCode) {
  const state = { hits: 0 };
  const server = http.createServer((_request, response) => {
    state.hits += 1;
    response.writeHead(statusCode);
    response.end();
  });
  await listen(server, 0);
  return {
    server,
    port: server.address().port,
    get hits() {
      return state.hits;
    },
  };
}

async function reservePort() {
  const server = http.createServer();
  await listen(server, 0);
  const port = server.address().port;
  await closeServer(server);
  return port;
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function onceExit(child) {
  return new Promise((resolve) => child.once('exit', resolve));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitUntilReady(port, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Caddy exited before readiness with status ${child.exitCode}`);
    }
    try {
      const status = await probeRequest(port);
      if (status === 404) return;
    } catch {
      // The listener is not ready yet.
    }
    await delay(100);
  }
  throw new Error('Caddy did not become ready');
}

function probeRequest(port) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, method: 'GET', path: '/__caddy_route_probe' },
      (response) => {
        response.resume();
        response.once('end', () => resolve(response.statusCode));
      },
    );
    request.once('error', reject);
    request.setTimeout(3_000, () => request.destroy(new Error('Caddy probe timed out')));
    request.end();
  });
}

async function expectRoute(port, targetValues, expectedStatus, extraRawHeaders = []) {
  const { body, status } = await rawRequest(port, targetValues, extraRawHeaders);
  assert.equal(
    status,
    expectedStatus,
    `unexpected route status for target values ${JSON.stringify(targetValues)}; body=${JSON.stringify(body)}`,
  );
}

function rawRequest(port, targetValues, extraRawHeaders = []) {
  const rawHeaders = ['Host', `127.0.0.1:${port}`, 'Content-Type', mediaType, ...extraRawHeaders];
  for (const value of targetValues) {
    rawHeaders.push(targetHeader, value);
  }
  rawHeaders.push('Content-Length', '2');
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: routePath,
        headers: rawHeaders,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body = (body + chunk).slice(-1024);
        });
        response.once('end', () => resolve({ body, status: response.statusCode }));
      },
    );
    request.once('error', reject);
    request.setTimeout(3_000, () => request.destroy(new Error('Caddy route request timed out')));
    request.end('{}');
  });
}
