import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';

import { prepareCbeReferenceWorkerDelivery } from './cbe-reference-worker-delivery.mjs';

const encryptionMasterSecret = '11'.repeat(32);
const fingerprintMasterSecret = '22'.repeat(32);
const fingerprint = (hex) =>
  `sha256:${createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex')}`;
const profile = JSON.stringify({
  version: 2,
  encryptionMasterFingerprint: fingerprint(encryptionMasterSecret),
  fingerprintMasterFingerprint: fingerprint(fingerprintMasterSecret),
});

test('derives one CBE-only child and a nonsecret release pin', () => {
  const delivery = prepareCbeReferenceWorkerDelivery({
    rootProfileJson: profile,
    encryptionMasterSecret,
    fingerprintMasterSecret,
  });
  try {
    const [root, worker, key] = delivery.payload
      .toString('utf8')
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line));
    const expectedChild = createHmac('sha256', Buffer.from(encryptionMasterSecret, 'hex'))
      .update('fetanagent:deposit-proof-reference:encryption-key:v2\nprovider:cbe_birr')
      .digest('hex');
    assert.equal(key.keyHex, expectedChild);
    assert.equal(key.keyId, worker.keyId);
    assert.equal(worker.providerCode, 'cbe_birr');
    assert.equal(worker.sourceProfile, 'cbe_birr_official_receipt_lookup_v1');
    assert.equal(root.version, 2);
    assert.equal(delivery.pins.deploymentTarget, 'production');
    assert.match(delivery.planDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.doesNotMatch(JSON.stringify(delivery.pins), new RegExp(encryptionMasterSecret, 'u'));
  } finally {
    delivery.payload.fill(0);
  }
});

test('rejects a root profile that does not match the producer masters', () => {
  assert.throws(
    () =>
      prepareCbeReferenceWorkerDelivery({
        rootProfileJson: profile,
        encryptionMasterSecret: '33'.repeat(32),
        fingerprintMasterSecret,
      }),
    /delivery is unavailable/u,
  );
});
