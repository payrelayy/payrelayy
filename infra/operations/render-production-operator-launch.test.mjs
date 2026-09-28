import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { renderProductionOperatorLaunch } from './render-production-operator-launch.mjs';

const environment = {
  PRODUCTION_COMPANION_EXECUTION_REQUEST_KEY: 'a1b2c3d4-1111-4222-8333-aabbccddeeff',
  SUPABASE_DB_PASSWORD: 'contains:@/%? secret',
  SUPABASE_CA_CERTIFICATE_PEM: '-----BEGIN CERTIFICATE-----\nYWJjZA==\n-----END CERTIFICATE-----\n',
  PRODUCTION_COMPANION_RELEASE_TAG: 'windows-companion-v0.1.12',
};

test('one-use operator document is strict and percent-encodes the secret', () => {
  const document = JSON.parse(renderProductionOperatorLaunch(environment));
  assert.deepEqual(Object.keys(document).sort(), [
    'databaseCaPem',
    'databaseUrl',
    'releaseTag',
    'requestKey',
    'version',
  ]);
  assert.equal(document.version, 1);
  assert.equal(new URL(document.databaseUrl).password, 'contains%3A%40%2F%25%3F%20secret');
  assert.equal(new URL(document.databaseUrl).search, '?sslmode=verify-full');
  assert.equal(document.requestKey, environment.PRODUCTION_COMPANION_EXECUTION_REQUEST_KEY);
});

test('bad inputs fail without printing sensitive values', () => {
  assert.throws(() => renderProductionOperatorLaunch({ ...environment, SUPABASE_DB_PASSWORD: '' }));
  assert.throws(() =>
    renderProductionOperatorLaunch({
      ...environment,
      PRODUCTION_COMPANION_EXECUTION_REQUEST_KEY: 'not-a-key',
    }),
  );
  const processResult = spawnSync(
    process.execPath,
    ['infra/operations/render-production-operator-launch.mjs'],
    {
      env: { ...process.env, ...environment, PRODUCTION_COMPANION_RELEASE_TAG: 'invalid' },
      encoding: 'utf8',
    },
  );
  assert.equal(processResult.status, 1);
  assert.equal(processResult.stdout, '');
  assert.equal(processResult.stderr.includes(environment.SUPABASE_DB_PASSWORD), false);
  assert.equal(
    processResult.stderr.includes(environment.PRODUCTION_COMPANION_EXECUTION_REQUEST_KEY),
    false,
  );
});
