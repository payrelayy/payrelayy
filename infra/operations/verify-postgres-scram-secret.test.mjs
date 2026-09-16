import assert from 'node:assert/strict';
import { createHash, createHmac, pbkdf2Sync } from 'node:crypto';
import { test } from 'node:test';

import { verifyPostgresScramSha256Secret } from './verify-postgres-scram-secret.mjs';

function buildVerifier(secret, salt, iterations = 4096) {
  const saltedPassword = pbkdf2Sync(secret, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', saltedPassword).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', saltedPassword).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

test('accepts the exact PostgreSQL SCRAM-SHA-256 secret', () => {
  const secret = '0123456789abcdef'.repeat(4);
  const verifier = buildVerifier(secret, Buffer.from('fixed-postgres-salt-value'));
  assert.equal(verifyPostgresScramSha256Secret(secret, verifier), true);
});

test('rejects a different canonical runtime secret', () => {
  const secret = '0123456789abcdef'.repeat(4);
  const verifier = buildVerifier(secret, Buffer.from('fixed-postgres-salt-value'));
  assert.equal(verifyPostgresScramSha256Secret('fedcba9876543210'.repeat(4), verifier), false);
});

test('rejects malformed, weak, and non-SCRAM verifier material', () => {
  const secret = '0123456789abcdef'.repeat(4);
  const valid = buildVerifier(secret, Buffer.from('fixed-postgres-salt-value'));
  assert.equal(verifyPostgresScramSha256Secret(secret, ''), false);
  assert.equal(verifyPostgresScramSha256Secret(secret, valid.replace('4096:', '1024:')), false);
  assert.equal(verifyPostgresScramSha256Secret(secret, valid.replace(/=$/u, '')), false);
  assert.equal(verifyPostgresScramSha256Secret('not-a-runtime-secret', valid), false);
});
