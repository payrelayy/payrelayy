import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const botWorkflow = readFileSync(
  resolve(root, '.github/workflows/staging-telegram-bot.yml'),
  'utf8',
);
const edgeWorkflow = readFileSync(
  resolve(root, '.github/workflows/staging-public-domain.yml'),
  'utf8',
);

// Exercise the exact program that GitHub executes; every HTTP response is synthetic.
const program = botWorkflow.match(/node --input-type=module <<'NODE'\r?\n([\s\S]*?)\r?\n {10}NODE/);
assert.ok(program, 'The Telegram activation program must be available for offline tests.');
const source = program[1].replace(/^ {10}/gm, '');
const token = `123456789:${'t'.repeat(35)}`;
const fingerprint = `sha256:${createHash('sha256').update(token).digest('hex')}`;

function checkActivation(
  name,
  fixture,
  expectedSuccess,
  expectedMethods = ['getMe', 'getWebhookInfo'],
) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-'], {
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      PATH: process.env.PATH ?? '',
      SystemRoot: process.env.SystemRoot ?? '',
      STAGING_TELEGRAM_BOT_TOKEN: fixture.token ?? token,
      EXPECTED_TOKEN_SHA256: fixture.fingerprint ?? fingerprint,
    },
    input: `
const fixture = ${JSON.stringify(fixture)};
const methods = [];
globalThis.fetch = async (url, options) => {
  if (!url.startsWith('https://api.telegram.org/bot') ||
      options.method !== 'POST' || options.redirect !== 'error' || !options.signal) {
    throw new Error('Unexpected transport contract.');
  }
  const method = url.slice(url.lastIndexOf('/') + 1);
  methods.push(method);
  if (!['getMe', 'getWebhookInfo'].includes(method)) throw new Error('Unexpected API mutation.');
  if (fixture.networkError) throw new Error('PRIVATE_NETWORK_ERROR ' + process.env.STAGING_TELEGRAM_BOT_TOKEN);
  return {
    ok: !fixture.httpError,
    json: async () => {
      if (fixture.invalidJson) throw new Error('PRIVATE_PARSE_ERROR');
      return { ok: true, result: method === 'getMe'
        ? { is_bot: true, username: fixture.username ?? 'fetanagentbot' }
        : { url: fixture.webhookUrl ?? '', pending_update_count: fixture.pending } };
    },
  };
};
process.on('exit', () => console.log('tested_methods=' + JSON.stringify(methods)));
${source}
`,
  });
  assert.equal(result.error, undefined, `${name}: the isolated test must finish.`);
  assert.equal(result.status === 0, expectedSuccess, `${name}: ${result.stderr}`);
  assert.ok(
    result.stdout.includes(`tested_methods=${JSON.stringify(expectedMethods)}`),
    `${name}: only the expected read-only Telegram methods may run.`,
  );
  assert.equal(
    result.stdout.includes('telegram_identity_and_queue_preservation=pass'),
    expectedSuccess,
    `${name}: activation must report its real disposition.`,
  );
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_NETWORK_ERROR|PRIVATE_PARSE_ERROR/);
  assert.ok(!(result.stdout + result.stderr).includes(token), `${name}: never log the credential.`);
}

checkActivation('empty queue', { pending: 0 }, true);
checkActivation('waiting customer updates', { pending: 7 }, true);
checkActivation('large non-negative queue', { pending: Number.MAX_SAFE_INTEGER }, true);
for (const pending of [-1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 1, undefined]) {
  checkActivation(`invalid queue count ${String(pending)}`, { pending }, false);
}
checkActivation(
  'existing webhook is not removed',
  { pending: 0, webhookUrl: 'https://example.invalid/' },
  false,
);
checkActivation('different bot is rejected', { pending: 0, username: 'anotherbot' }, false, [
  'getMe',
]);
checkActivation(
  'fingerprint mismatch makes no request',
  { fingerprint: `sha256:${'0'.repeat(64)}` },
  false,
  [],
);
checkActivation('malformed token makes no request', { token: 'invalid' }, false, []);
checkActivation('transport failure is redacted', { networkError: true }, false, ['getMe']);
checkActivation('HTTP failure is unavailable', { httpError: true }, false, ['getMe']);
checkActivation('JSON failure is redacted', { invalidJson: true }, false, ['getMe']);

for (const workflow of [botWorkflow, edgeWorkflow]) {
  assert.match(workflow, /GITHUB_REF" == 'refs\/heads\/main'/);
  assert.match(workflow, /CONFIRMED_COMMIT" =~ \^\[0-9a-f\]\{40\}\$/);
  assert.match(workflow, /git merge-base --is-ancestor "\$CONFIRMED_COMMIT" "\$GITHUB_SHA"/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /ref: \$\{\{ inputs\.confirm_main_commit_sha \}\}/);
  assert.match(workflow, /DEPLOYED_RELEASE_SHA: \$\{\{ inputs\.confirm_main_commit_sha \}\}/);
  assert.doesNotMatch(workflow, /fetanagent-staging-deploy-helper [^\n]*\$GITHUB_SHA/);
  assert.match(workflow, /StrictHostKeyChecking=yes/);
  assert.match(workflow, /fetanagent-staging-deploy-helper verify/);
}
assert.doesNotMatch(botWorkflow, /getUpdates|deleteWebhook|drop_pending_updates|setWebhook/);
for (const command of [
  'bot-disabled-ready',
  'install-bot-token',
  'start-bot',
  'bot-ready',
  'stop-bot',
]) {
  assert.match(botWorkflow, new RegExp(`${command} '\\$DEPLOYED_RELEASE_SHA'`));
}
for (const command of ['fresh-public-edge-ready', 'start-fresh-public-edge']) {
  assert.match(edgeWorkflow, new RegExp(`${command} '\\$DEPLOYED_RELEASE_SHA'`));
}
console.log('Telegram queue-preserving activation and exact deployed-release checks passed.');
