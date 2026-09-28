import { createHash, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { checkedExecutionSignerPrivateKey, signerPublicKey } from './index.js';

const key = Buffer.alloc(91, 7);
const row = {
  public_key_spki: key.toString('base64url'),
  public_key_spki_sha256: `sha256:${createHash('sha256').update(key).digest('hex')}`,
};

describe('production signer public-key loader', () => {
  it('accepts only one canonical database-backed signer key', () => {
    expect(Buffer.from(signerPublicKey([row]))).toEqual(key);
    expect(() => signerPublicKey([])).toThrow();
    expect(() => signerPublicKey([row, row])).toThrow();
    expect(() =>
      signerPublicKey([{ ...row, public_key_spki_sha256: `sha256:${'0'.repeat(64)}` }]),
    ).toThrow();
  });
});

describe('protected execution signer loader', () => {
  it('accepts only a key matching the pinned public digest', () => {
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const raw = pair.privateKey.export({ format: 'der', type: 'pkcs8' });
    const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' });
    const digest = `sha256:${createHash('sha256').update(publicKey).digest('hex')}`;
    expect(checkedExecutionSignerPrivateKey(raw, digest).asymmetricKeyType).toBe('ec');
    expect(() => checkedExecutionSignerPrivateKey(raw)).toThrow();
    expect(() => checkedExecutionSignerPrivateKey(Buffer.from('invalid'), digest)).toThrow();
    raw.fill(0);
  });
});
