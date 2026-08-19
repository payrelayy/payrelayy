import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const dockerfile = await readFile(`${repositoryRoot}Dockerfile`, 'utf8');
const workflow = await readFile(
  `${repositoryRoot}.github/workflows/customer-web-image-smoke.yml`,
  'utf8',
);

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
      assert.ok(index < lines.length, 'unterminated customer web image smoke docker run');
      commandLines.push(lines[index]);
    }
    commands.push(commandLines.join('\n'));
  }
  return commands;
}

assert.match(dockerfile, /FROM build-base AS customer-web-build/);
assert.match(dockerfile, /pnpm --filter @fetanagent\/customer-web\.\.\. run build/);

const customerWebImage = dockerfile
  .split('FROM runtime-base AS customer-web')[1]
  ?.split('# The executor uses the distribution-provided Chromium')[0];
assert.ok(customerWebImage, 'missing customer web image body');
assert.match(customerWebImage, /org\.opencontainers\.image\.title="fetanagent-customer-web"/);
assert.match(customerWebImage, /org\.opencontainers\.image\.revision="\$\{VCS_REF\}"/);
assert.match(
  customerWebImage,
  /COPY --from=customer-web-build --chown=10001:10001 \/workspace\/node_modules/,
);
assert.match(
  customerWebImage,
  /COPY --from=customer-web-build --chown=10001:10001 \/workspace\/packages/,
);
assert.match(
  customerWebImage,
  /COPY --from=customer-web-build --chown=10001:10001 \/workspace\/apps\/customer-web \.\/apps\/customer-web/,
);
assert.match(customerWebImage, /HEALTHCHECK .*127\.0\.0\.1:3003\/readyz/);
assert.match(
  customerWebImage,
  /HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3/,
);
assert.match(customerWebImage, /CMD \["node", "apps\/customer-web\/dist\/index\.js"\]/);
assert.doesNotMatch(customerWebImage, /\bEXPOSE\b|docker\.sock|\/run\/secrets/);

const triggers = topLevelSection(workflow, 'on');
assert.deepEqual(
  [...triggers.matchAll(/^  ([a-z][a-z_]*)\s*:\s*$/gm)].map((match) => match[1]),
  ['push', 'pull_request'],
  'the customer web image smoke must run only for main pushes and pull requests',
);
for (const trigger of ['push', 'pull_request']) {
  assert.match(
    triggers,
    new RegExp(
      `^  ${escapeRegExp(trigger)}:\\s*\\r?\\n    branches:\\s*\\r?\\n      - main\\s*$`,
      'm',
    ),
  );
}
assert.doesNotMatch(
  workflow,
  /^\s*(?:workflow_dispatch|schedule|workflow_call|repository_dispatch):/m,
);
assert.match(workflow, /^permissions:\s*\r?\n  contents: read$/m);
assert.match(workflow, /timeout-minutes: 20/);
assert.match(workflow, /actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/);
assert.match(workflow, /persist-credentials: false/);

assert.match(
  workflow,
  /docker build --pull=false --target customer-web[\s\S]*--build-arg "VCS_REF=\$GITHUB_SHA"/,
);
assert.match(workflow, /'10001:10001'/);
assert.match(workflow, /'\["node","apps\/customer-web\/dist\/index\.js"\]'/);
assert.match(workflow, /org\.opencontainers\.image\.revision[\s\S]*= \\?[\r\n\s]*"\$GITHUB_SHA"/);
assert.match(workflow, /grep -Fx 'NODE_ENV=production'/);

assert.match(workflow, /test "\$startup_status" -eq 1/);
assert.match(workflow, /The customer web Auth runtime gate is disabled\./);
assert.match(workflow, /apps\/customer-web\/dist\/app\.js/);
assert.match(workflow, /The inert image smoke must not call Auth or PostgreSQL\./);
assert.match(workflow, /publicOrigin: 'https:\/\/fetanagent\.com'/);
assert.match(workflow, /health\.status !== 200/);
assert.match(workflow, /healthBody\.status !== 'ok'/);
assert.match(workflow, /readiness\.status !== 503/);
assert.match(workflow, /readinessBody\.status !== 'unavailable'/);

const requiredEnvironment = new Map([
  ['NODE_ENV', 'production'],
  ['FINANCIAL_ACTIONS_MODE', 'dry_run'],
  ['INTERNAL_CUSTOMER_WEB_AUTH_RUNTIME_ENABLED', 'false'],
  ['INTERNAL_CUSTOMER_WEB_WORKSPACE_RUNTIME_ENABLED', 'false'],
  ['INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED', 'false'],
  ['INTERNAL_CUSTOMER_WEB_DURABLE_RATE_LIMIT_ENABLED', 'false'],
]);
const dockerRuns = continuedDockerRunCommands(workflow);
assert.equal(dockerRuns.length, 2, 'unexpected customer web image smoke container');
for (const dockerRun of dockerRuns) {
  assert.match(dockerRun, /--network none/);
  assert.match(dockerRun, /--read-only/);
  assert.match(dockerRun, /--tmpfs \/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777/);
  assert.match(dockerRun, /--cap-drop ALL/);
  assert.match(dockerRun, /--security-opt no-new-privileges/);
  assert.doesNotMatch(dockerRun, /--mount\b|--volume\b|(?:^|\s)-v(?:\s|=)/m);
  assert.doesNotMatch(dockerRun, /--env-file\b/);
  assert.doesNotMatch(dockerRun, /(?:^|\s)-e(?:\s|=|[^\s\\])/m);
  assert.match(dockerRun, /"\$CUSTOMER_WEB_IMAGE"/);

  const environmentOptionCount = [...dockerRun.matchAll(/--env\b/g)].length;
  const environmentAssignments = [...dockerRun.matchAll(/--env(?:\s+|=)([^\s\\]+)/g)].map(
    (match) => match[1],
  );
  assert.equal(
    environmentAssignments.length,
    environmentOptionCount,
    'customer web image smoke environment options must use explicit NAME=value assignments',
  );
  const parsedEnvironment = environmentAssignments.map((assignment) => {
    const separator = assignment.indexOf('=');
    assert.ok(separator > 0, 'customer web image smoke environment assignments must name a value');
    return [assignment.slice(0, separator), assignment.slice(separator + 1)];
  });
  assert.equal(
    new Set(parsedEnvironment.map(([name]) => name)).size,
    parsedEnvironment.length,
    'customer web image smoke environment assignments must not contain duplicates',
  );
  assert.deepEqual(
    new Map(parsedEnvironment),
    requiredEnvironment,
    'customer web image smoke must use the exact fail-closed environment assignment set',
  );
}

assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./);
assert.doesNotMatch(
  workflow,
  /FINANCIAL_ACTIONS_MODE\s*[:=]\s*live\b|INTERNAL_CUSTOMER_WEB_(?:AUTH|WORKSPACE|DEPOSIT)_RUNTIME_ENABLED\s*[:=]\s*true\b|INTERNAL_CUSTOMER_WEB_DURABLE_RATE_LIMIT_ENABLED\s*[:=]\s*true\b/,
  'the customer web image smoke must never enable a live runtime',
);
assert.doesNotMatch(
  workflow,
  /CUSTOMER_WEB_(?:DATABASE_URL|SUPABASE_PUBLISHABLE_KEY|RATE_LIMIT_HMAC_SECRET)|CBE_DEPOSIT_REFERENCE_(?:ENCRYPTION|FINGERPRINT)_SECRET/,
  'the customer web image smoke must not receive a project, database, or reference-protection secret',
);
assert.doesNotMatch(
  workflow,
  /\b(?:docker\s+(?:push|compose)|kubectl|helm|ssh|scp|rsync|doctl|supabase)\b/,
  'the customer web image smoke must not contain a deployment or database command',
);

console.log(
  'customer web image artifacts verified: pinned build target, non-root runtime, fail-closed entrypoint, and inert health boundary',
);
