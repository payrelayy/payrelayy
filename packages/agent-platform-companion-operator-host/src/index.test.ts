import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { signerPublicKey } from './index.js';

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
