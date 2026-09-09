import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFile(`${repositoryRoot}${path}`, 'utf8');
const [
  dockerfile,
  compose,
  workflow,
  manifestText,
  applicationSource,
  healthSource,
  healthServerSource,
  workerSource,
  postgresSource,
  mainSource,
  environmentExample,
] = await Promise.all([
  read('Dockerfile'),
  read('infra/compose.trusted-telebirr-verifier.yaml'),
  read('.github/workflows/trusted-telebirr-verifier-image-smoke.yml'),
  read('apps/trusted-telebirr-verifier/package.json'),
  read('apps/trusted-telebirr-verifier/src/trusted-telebirr-verifier-application.ts'),
  read('apps/trusted-telebirr-verifier/src/trusted-telebirr-verifier-health.ts'),
  read('apps/trusted-telebirr-verifier/src/trusted-telebirr-verifier-health-server.ts'),
  read('apps/trusted-telebirr-verifier/src/trusted-telebirr-verifier-worker.ts'),
  read('apps/trusted-telebirr-verifier/src/postgres-trusted-telebirr-verifier.ts'),
  read('apps/trusted-telebirr-verifier/src/trusted-telebirr-verifier-main.ts'),
  read('.env.example'),
]);
const manifest = JSON.parse(manifestText);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function topLevelSection(value, name) {
  const header = new RegExp(`^${escapeRegExp(name)}:\\s*$`, 'm').exec(value);
  assert.ok(header, `missing top-level ${name} section`);
  const start = header.index + header[0].length;
  const remainder = value.slice(start);
  const next = /^\S[^\r\n]*:\s*$/m.exec(remainder);
  return remainder.slice(0, next?.index ?? remainder.length);
}

function continuedDockerRunCommands(value) {
  const lines = value.split(/\r?\n/u);
  const commands = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*docker run\b/u.test(lines[index])) continue;
    const commandLines = [lines[index]];
    while (/\\\s*$/u.test(commandLines.at(-1))) {
      index += 1;
      assert.ok(index < lines.length, 'unterminated verifier image-smoke docker run');
      commandLines.push(lines[index]);
    }
    commands.push(commandLines.join('\n'));
  }
  return commands;
}

assert.equal(
  manifest.scripts.start,
  'node dist/trusted-telebirr-verifier-main.js',
  'the package must have exactly one production entrypoint',
);

assert.match(dockerfile, /FROM build-base AS trusted-telebirr-verifier-build/);
assert.match(dockerfile, /pnpm --filter @fetanagent\/trusted-telebirr-verifier\.\.\. run build/);
const verifierImage = dockerfile
  .split('FROM runtime-base AS trusted-telebirr-verifier')[1]
  ?.split('# The executor uses the distribution-provided Chromium')[0];
assert.ok(verifierImage, 'missing dedicated trusted TeleBirr verifier image body');
assert.match(
  verifierImage,
  /org\.opencontainers\.image\.title="fetanagent-trusted-telebirr-verifier"/,
);
assert.match(verifierImage, /org\.opencontainers\.image\.revision="\$\{VCS_REF\}"/);
assert.match(
  verifierImage,
  /COPY --from=trusted-telebirr-verifier-build --chown=10001:10001 \/workspace\/node_modules/,
);
assert.match(
  verifierImage,
  /COPY --from=trusted-telebirr-verifier-build --chown=10001:10001 \/workspace\/packages/,
);
assert.match(
  verifierImage,
  /COPY --from=trusted-telebirr-verifier-build --chown=10001:10001 \/workspace\/apps\/trusted-telebirr-verifier/,
);
assert.match(verifierImage, /127\.0\.0\.1:8091\/readyz/);
assert.match(
  verifierImage,
  /CMD \["node", "apps\/trusted-telebirr-verifier\/dist\/trusted-telebirr-verifier-main\.js"\]/,
);
assert.doesNotMatch(
  verifierImage,
  /\bEXPOSE\b|docker\.sock|COPY[^\r\n]*\/run\/(?:secrets|configs)/,
);
for (const proxyName of [
  'HTTP_PROXY',
  'http_proxy',
  'HTTPS_PROXY',
  'https_proxy',
  'NO_PROXY',
  'no_proxy',
  'FTP_PROXY',
  'ftp_proxy',
  'ALL_PROXY',
  'all_proxy',
]) {
  assert.match(verifierImage, new RegExp(`\\b${proxyName}=`));
}

assert.match(applicationSource, /loadTrustedTelebirrVerifierConfig/);
assert.match(applicationSource, /createTrustedTelebirrPostgresRuntime/);
assert.match(applicationSource, /createTrustedTelebirrVerifier/);
assert.match(applicationSource, /createTrustedTelebirrVerifierWorker/);
assert.match(applicationSource, /await exactRuntime\.ready\(\)/);
assert.match(applicationSource, /TRUSTED_TELEBIRR_VERIFIER_SHUTDOWN_TIMEOUT_MS = 15_000/);
assert.match(applicationSource, /signalSource\.once\('SIGINT', onSignal\)/);
assert.match(applicationSource, /signalSource\.once\('SIGTERM', onSignal\)/);
assert.match(
  applicationSource,
  /Promise\.allSettled\(\[healthServer\.close\(\), worker\.stop\(\)\]\)/,
);
assert.match(applicationSource, /Promise\.allSettled\(\[exactRuntime\.close\(\)\]\)/);
assert.match(applicationSource, /await worker\.run\(\)/);
assert.doesNotMatch(applicationSource, /\.verifyAndComplete\(/);
assert.doesNotMatch(applicationSource, /createServer|listen\(/);
assert.match(workerSource, /dependencies\.source\.loadNext\(\)/);
assert.match(workerSource, /dependencies\.verifier\.verifyAndComplete\(request\)/);
assert.match(workerSource, /dependencies\.source\.quarantineInvalid/);
assert.match(workerSource, /redactedTrustedTelebirrVerificationForLog/);
assert.doesNotMatch(workerSource, /createServer|listen\(|fetch\(|WebSocket|XMLHttpRequest/);
assert.match(postgresSource, /load_next_private_live_telebirr_staged_evidence/);
assert.match(postgresSource, /quarantine_private_live_telebirr_staged_evidence/);
assert.match(postgresSource, /select count\(\*\) = 4/);
assert.match(healthSource, /TRUSTED_TELEBIRR_VERIFIER_HEALTH_HOST = '127\.0\.0\.1'/);
assert.match(healthSource, /TRUSTED_TELEBIRR_VERIFIER_HEALTH_PORT = 8091/);
assert.match(healthSource, /database_unavailable/);
assert.doesNotMatch(
  healthSource,
  /verificationAttemptId|leaseToken|completionRequestKey|receiverIdentityDigest|keyId/,
);
assert.match(healthServerSource, /options\.host !== '127\.0\.0\.1'/);
assert.match(healthServerSource, /request\.url === '\/healthz'/);
assert.match(healthServerSource, /request\.url === '\/readyz'/);
assert.doesNotMatch(healthServerSource, /verifyAndComplete|\/verify|\/observation|\/complete/);
assert.match(mainSource, /FetanAgent trusted TeleBirr verifier failed closed\./);

assert.match(compose, /^\s{4}profiles: \[trusted-telebirr-verifier\]$/m);
assert.match(compose, /^\s{4}platform: linux\/amd64$/m);
assert.match(
  compose,
  /image: \$\{FETANAGENT_TRUSTED_TELEBIRR_VERIFIER_IMAGE_REFERENCE:\?[^\r\n]*@sha256[^\r\n]*\}/,
);
assert.match(compose, /^\s{4}user: '10001:10001'$/m);
assert.match(compose, /^\s{4}read_only: true$/m);
assert.match(compose, /^\s{6}- ALL$/m);
assert.match(compose, /^\s{6}- no-new-privileges:true$/m);
assert.match(compose, /^\s{4}stop_grace_period: 20s$/m);
assert.match(compose, /^\s{6}replicas: 1$/m);
assert.match(compose, /127\.0\.0\.1:8091\/readyz/);
assert.match(compose, /TRUSTED_TELEBIRR_VERIFIER_DEPLOYMENT_TARGET: staging/);
assert.match(compose, /INTERNAL_TRUSTED_TELEBIRR_VERIFIER_ENABLED: \$\{[^\r\n]+:\?[^\r\n]+\}/);
assert.match(compose, /TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED: \$\{[^\r\n]+:\?[^\r\n]+\}/);
assert.match(compose, /FINANCIAL_ACTIONS_MODE: \$\{[^\r\n]+:\?[^\r\n]+\}/);
assert.match(compose, /mode: 0400/);
assert.equal((compose.match(/mode: 0444/gu) ?? []).length, 2);
assert.doesNotMatch(
  compose,
  /^\s+(?:ports|expose|build|privileged|network_mode|pid|ipc):|docker\.sock|\/var\/run\/docker/im,
  'the verifier Compose service must have no public/inherited ingress, build, privilege, or Docker control surface',
);
assert.doesNotMatch(
  compose,
  /password|private[_ -]?key|service[_ -]?role|TELEGRAM_BOT_TOKEN|KEMERBET/i,
  'the Compose artifact must contain no credential value or unrelated provider authority',
);

for (const gate of [
  'INTERNAL_TRUSTED_TELEBIRR_VERIFIER_ENABLED',
  'TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED',
]) {
  assert.match(environmentExample, new RegExp(`^${gate}=false$`, 'm'));
}

const triggers = topLevelSection(workflow, 'on');
assert.deepEqual(
  [...triggers.matchAll(/^  ([a-z][a-z_]*)\s*:\s*$/gm)].map((match) => match[1]),
  ['push', 'pull_request'],
);
assert.match(workflow, /^permissions:\s*\r?\n  contents: read$/m);
assert.match(workflow, /actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/);
assert.match(workflow, /persist-credentials: false/);
assert.match(workflow, /docker build --pull=false --target trusted-telebirr-verifier/);
assert.match(workflow, /'10001:10001'/);
assert.match(
  workflow,
  /'\["node","apps\/trusted-telebirr-verifier\/dist\/trusted-telebirr-verifier-main\.js"\]'/,
);
assert.match(workflow, /'FetanAgent trusted TeleBirr verifier failed closed\.'/);
assert.match(workflow, /readinessBody\.reason !== 'database_unavailable'/);
assert.match(workflow, /forbidden\.status !== 404/);
assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./);
assert.doesNotMatch(
  workflow,
  /FINANCIAL_ACTIONS_MODE=(?:live)|(?:INTERNAL_TRUSTED_TELEBIRR_VERIFIER_ENABLED|TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED)=(?:true)/,
  'image smoke must keep all real verifier activation gates off',
);
assert.doesNotMatch(
  workflow,
  /TRUSTED_TELEBIRR_VERIFIER_(?:DATABASE_URL|PIN_MANIFEST)|NODE_EXTRA_CA_CERTS|SUPABASE_CA/,
  'image smoke must not receive a database URL, pins, or CA input',
);
assert.doesNotMatch(
  workflow,
  /\b(?:docker\s+(?:push|compose)|kubectl|helm|ssh|scp|rsync|doctl|supabase)\b/,
  'image smoke must not deploy or mutate a provider',
);
const dockerRuns = continuedDockerRunCommands(workflow);
assert.equal(dockerRuns.length, 2, 'unexpected verifier image-smoke container count');
for (const dockerRun of dockerRuns) {
  assert.match(dockerRun, /--network none/);
  assert.match(dockerRun, /--read-only/);
  assert.match(dockerRun, /--cap-drop ALL/);
  assert.match(dockerRun, /--security-opt no-new-privileges/);
  assert.doesNotMatch(dockerRun, /--mount\b|--volume\b|(?:^|\s)-v(?:\s|=)/m);
  assert.doesNotMatch(dockerRun, /--env-file\b/);
}

console.log(
  'trusted TeleBirr verifier deployment artifacts verified: pinned image, opt-in no-public-ingress Compose, direct singleton staged-evidence worker, bounded shutdown, redacted loopback health, and inert CI smoke',
);
