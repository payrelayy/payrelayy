import { createHash, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  COMPANION_LAUNCH_PROOF_PURPOSE,
  signCompanionLaunchProof,
  verifyCompanionLaunchProof,
  type CompanionLaunchProofContext,
} from './launch-proof.js';

const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const spki = Buffer.from(device.publicKey.export({ format: 'der', type: 'spki' }));
const challenge = Buffer.alloc(32, 0x5a).toString('base64url');
const context: CompanionLaunchProofContext = {
  challenge,
  certificateBodyDigest: `sha256:${'a'.repeat(64)}`,
  deviceKeyId: 'paired-device-key-v1',
  devicePublicKeySpki: spki.toString('base64url'),
  releaseSha: 'b'.repeat(40),
  installationTreeSha256: `sha256:${'c'.repeat(64)}`,
  processId: 4242,
  startedAt: '2026-09-26T12:00:00.000Z',
  observedAt: '2026-09-26T12:01:00.000Z',
};

describe('paired Windows companion launch proof', () => {
  it('signs only a canonical process-and-installation-bound transcript', () => {
    const proof = signCompanionLaunchProof(context, device.privateKey);
    expect(proof).toBeDefined();
    expect(proof?.body.purpose).toBe(COMPANION_LAUNCH_PROOF_PURPOSE);
    expect(proof?.body.challengeDigest).toBe(
      `sha256:${createHash('sha256').update(Buffer.from(challenge, 'base64url')).digest('hex')}`,
    );
    expect(verifyCompanionLaunchProof(proof, context)).toBe(true);
    expect(Object.keys(proof?.body ?? {})).toEqual([
      'contractVersion',
      'purpose',
      'challengeDigest',
      'certificateBodyDigest',
      'deviceKeyId',
      'releaseSha',
      'installationTreeSha256',
      'processId',
      'startedAt',
      'observedAt',
    ]);
  });

  it('rejects replay against another challenge, certificate, release, tree, or process', () => {
    const proof = signCompanionLaunchProof(context, device.privateKey);
    expect(proof).toBeDefined();
    for (const changed of [
      { challenge: Buffer.alloc(32, 0x5b).toString('base64url') },
      { certificateBodyDigest: `sha256:${'d'.repeat(64)}` },
      { deviceKeyId: 'another-device-key-v1' },
      { releaseSha: 'd'.repeat(40) },
      { installationTreeSha256: `sha256:${'d'.repeat(64)}` },
      { processId: 4243 },
      { startedAt: '2026-09-26T12:00:01.000Z' },
      { observedAt: '2026-09-26T12:01:01.000Z' },
    ]) {
      expect(verifyCompanionLaunchProof(proof, { ...context, ...changed })).toBe(false);
    }
  });

  it('rejects extra fields, a changed signature, a different key, and invalid lifetimes', () => {
    const proof = signCompanionLaunchProof(context, device.privateKey)!;
    expect(verifyCompanionLaunchProof({ ...proof, extra: true }, context)).toBe(false);
    expect(
      verifyCompanionLaunchProof({ ...proof, body: { ...proof.body, extra: true } }, context),
    ).toBe(false);
    expect(
      verifyCompanionLaunchProof({ ...proof, body: { ...proof.body, processId: 4243 } }, context),
    ).toBe(false);
    expect(verifyCompanionLaunchProof({ ...proof, signature: 'a'.repeat(86) }, context)).toBe(
      false,
    );
    const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    expect(signCompanionLaunchProof(context, other.privateKey)).toBeUndefined();
    expect(
      verifyCompanionLaunchProof(proof, {
        ...context,
        devicePublicKeySpki: Buffer.from(
          other.publicKey.export({ format: 'der', type: 'spki' }),
        ).toString('base64url'),
      }),
    ).toBe(false);
    expect(
      signCompanionLaunchProof(
        { ...context, observedAt: '2026-09-27T00:00:00.001Z' },
        device.privateKey,
      ),
    ).toBeUndefined();
    expect(
      signCompanionLaunchProof(
        { ...context, startedAt: '2026-09-26T12:02:00.000Z' },
        device.privateKey,
      ),
    ).toBeUndefined();
  });
});
