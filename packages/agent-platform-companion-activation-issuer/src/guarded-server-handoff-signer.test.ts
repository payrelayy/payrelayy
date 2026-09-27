import { createHash, generateKeyPairSync, randomUUID, verify } from 'node:crypto';

import {
  COMPANION_EXECUTION_ACTIVATION_HANDOFF_PURPOSE,
  type CompanionActivationReleaseAttestation,
} from '@fetanagent/agent-platform-companion-execution-contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  GuardedServerHandoffSigningUnavailableError,
  signGuardedServerCompanionHandoffWithSigner,
  type GuardedServerHandoffSignerInput,
} from './guarded-server-handoff-signer.js';

const signer = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const signerSpki = Buffer.from(signer.publicKey.export({ format: 'der', type: 'spki' }));
const deviceSpki = Buffer.from(device.publicKey.export({ format: 'der', type: 'spki' }));
const trustedSigner = {
  keyId: 'test-protected-signer',
  publicKeySpkiSha256: `sha256:${createHash('sha256').update(signerSpki).digest('hex')}`,
};
const requestKey = randomUUID();
const pilotRevisionId = randomUUID();
const certificateId = randomUUID();
const accountId = randomUUID();
const requestTime = new Date('2026-09-27T12:00:00.000Z');
const release: CompanionActivationReleaseAttestation = {
  releaseSha: 'a'.repeat(40),
  archiveSha256: `sha256:${'b'.repeat(64)}`,
  installationTreeSha256: `sha256:${'c'.repeat(64)}`,
  observedAt: '2026-09-27T12:00:30.000Z',
};

function row(): Record<string, unknown> {
  return {
    request_key: requestKey,
    request_pilot_revision_id: pilotRevisionId,
    request_activation_epoch: '1',
    request_certificate_id: certificateId,
    request_account_id: accountId,
    companion_release_sha: release.releaseSha,
    companion_archive_sha256: release.archiveSha256,
    companion_installation_tree_sha256: release.installationTreeSha256,
    requested_at: requestTime,
    request_expires_at: new Date(requestTime.getTime() + 600_000),
    current_pilot_revision_id: pilotRevisionId,
    current_activation_epoch: '1',
    current_certificate_id: certificateId,
    current_account_id: accountId,
    certificate_body_digest: `sha256:${'d'.repeat(64)}`,
    device_key_id: 'test-device-key-01',
    device_public_key_spki: deviceSpki.toString('base64url'),
    device_public_key_spki_sha256: `sha256:${createHash('sha256').update(deviceSpki).digest('hex')}`,
    certificate_valid_from: new Date('2026-09-27T11:00:00.000Z'),
    certificate_valid_until: new Date('2026-09-27T15:00:00.000Z'),
  };
}

function fixture(): GuardedServerHandoffSignerInput {
  return {
    requestKey,
    administrator: { query: vi.fn(async () => ({ rows: [row()] })) },
    verifyPublishedRelease: vi.fn(async () => release),
    signerPrivateKey: signer.privateKey,
    trustedNow: () => new Date('2026-09-27T12:01:00.000Z'),
  };
}

async function unavailable(input: GuardedServerHandoffSignerInput): Promise<void> {
  await expect(signGuardedServerCompanionHandoffWithSigner(input, trustedSigner)).rejects.toThrow(
    GuardedServerHandoffSigningUnavailableError,
  );
}

describe('protected server handoff signing core', () => {
  it('derives the signed handoff only from a stable database request and verified release', async () => {
    const input = fixture();
    const signed = await signGuardedServerCompanionHandoffWithSigner(input, trustedSigner);
    expect(input.administrator.query).toHaveBeenCalledTimes(3);
    expect(input.verifyPublishedRelease).toHaveBeenCalledTimes(1);
    expect(signed.body.requestKey).toBe(requestKey);
    expect(signed.body.expiresAt).toBe('2026-09-27T14:10:00.000Z');
    expect(signed.signerKeyId).toBe(trustedSigner.keyId);
    expect(
      verify(
        'sha256',
        Buffer.from(
          `${COMPANION_EXECUTION_ACTIVATION_HANDOFF_PURPOSE}\0${JSON.stringify(signed.body)}`,
        ),
        { key: signer.publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signed.signature, 'base64url'),
      ),
    ).toBe(true);
  });

  it('refuses a mismatched release or production signing key', async () => {
    const input = fixture();
    await unavailable({
      ...input,
      verifyPublishedRelease: async () => ({
        ...release,
        archiveSha256: `sha256:${'e'.repeat(64)}`,
      }),
    });
    await unavailable({
      ...input,
      signerPrivateKey: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey,
    });
  });

  it('refuses a changed database identity before or after signing', async () => {
    for (const changedAt of [2, 3]) {
      let calls = 0;
      const input = fixture();
      await unavailable({
        ...input,
        administrator: {
          async query() {
            calls += 1;
            return {
              rows: [calls >= changedAt ? { ...row(), current_account_id: randomUUID() } : row()],
            };
          },
        },
      });
      expect(calls).toBe(changedAt);
    }
  });

  it('refuses a request that expires during signing', async () => {
    const input = fixture();
    let clockReads = 0;
    await unavailable({
      ...input,
      trustedNow: () =>
        new Date(clockReads++ === 0 ? '2026-09-27T12:01:00.000Z' : '2026-09-27T12:10:00.000Z'),
    });
  });

  it('refuses a backwards trusted clock after signing', async () => {
    const input = fixture();
    let clockReads = 0;
    await unavailable({
      ...input,
      trustedNow: () =>
        new Date(clockReads++ === 0 ? '2026-09-27T12:01:00.000Z' : '2026-09-27T12:00:45.000Z'),
    });
  });

  it('fails closed without an exact database row or independent release check', async () => {
    const input = fixture();
    await unavailable({ ...input, administrator: { query: async () => ({ rows: [] }) } });
    await unavailable({
      ...input,
      verifyPublishedRelease: async () => {
        throw new Error('internal credential text must not escape');
      },
    });
  });
});
