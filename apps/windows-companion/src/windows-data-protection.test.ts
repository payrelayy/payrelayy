import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createWindowsCurrentUserDataProtector } from './windows-data-protection.js';

describe('Windows current-user data protection', () => {
  it.skipIf(process.platform !== 'win32')(
    'round-trips a random key through the real current-user DPAPI boundary',
    async () => {
      const protector = createWindowsCurrentUserDataProtector();
      const cleartext = randomBytes(32);
      let ciphertext: Buffer | null = null;
      let opened: Buffer | null = null;
      try {
        ciphertext = await protector.protect(cleartext);
        opened = await protector.unprotect(ciphertext);
        expect(opened).toEqual(cleartext);
        expect(ciphertext).not.toEqual(cleartext);
      } finally {
        cleartext.fill(0);
        ciphertext?.fill(0);
        opened?.fill(0);
      }
    },
    90_000,
  );

  it.skipIf(process.platform !== 'win32')(
    'keeps the device signing key in a separate DPAPI purpose domain',
    async () => {
      const identityProtector = createWindowsCurrentUserDataProtector(
        process.env,
        'local-identity',
      );
      const deviceProtector = createWindowsCurrentUserDataProtector(
        process.env,
        'device-signing-key',
      );
      const cleartext = randomBytes(32);
      let ciphertext: Buffer | null = null;
      try {
        ciphertext = await deviceProtector.protect(cleartext);
        await expect(identityProtector.unprotect(ciphertext)).rejects.toThrow();
        await expect(deviceProtector.unprotect(ciphertext)).resolves.toEqual(cleartext);
      } finally {
        cleartext.fill(0);
        ciphertext?.fill(0);
      }
    },
    90_000,
  );
});
