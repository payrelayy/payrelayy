import { createHash, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  matchesCompanionActivationEvidence,
  type CompanionActivationEvidenceContext,
} from './activation-evidence.js';
import { signCompanionExecutionLaunchProof, signCompanionLaunchProof } from './launch-proof.js';

const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const otherDevice = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const publicKey = Buffer.from(device.publicKey.export({ format: 'der', type: 'spki' }));
const challenge = Buffer.alloc(32, 0x3d).toString('base64url');
const certificateBodyDigest = `sha256:${'a'.repeat(64)}`;
const releaseSha = 'b'.repeat(40);
const archiveSha256 = `sha256:${'c'.repeat(64)}`;
const installationTreeSha256 = `sha256:${'d'.repeat(64)}`;
const executionHandoffSha256 = `sha256:${'e'.repeat(64)}`;
const requestKey = '11111111-1111-4111-8111-111111111111';
const pilotRevisionId = '22222222-2222-4222-8222-222222222222';
const certificateId = '33333333-3333-4333-8333-333333333333';
const platformAgentAccountId = '44444444-4444-4444-8444-444444444444';

function fixture(): CompanionActivationEvidenceContext {
  const process = {
    requestKey,
    challenge,
    challengeIssuedAt: '2026-09-26T12:00:15.000Z',
    processId: 4242,
    startedAt: '2026-09-26T12:00:16.000Z',
    observedAt: '2026-09-26T12:01:00.000Z',
    executionHandoffSha256,
  };
  const proof = signCompanionExecutionLaunchProof(
    {
      challenge,
      certificateBodyDigest,
      deviceKeyId: 'paired-device-key-v1',
      devicePublicKeySpki: publicKey.toString('base64url'),
      releaseSha,
      installationTreeSha256,
      requestKey,
      activationEpoch: '123',
      platformAgentAccountId,
      executionHandoffSha256,
      processId: process.processId,
      startedAt: process.startedAt,
      observedAt: process.observedAt,
    },
    device.privateKey,
  );
  if (!proof) throw new Error('Test signing failed');
  return {
    request: {
      requestKey,
      pilotRevisionId,
      activationEpoch: '123',
      certificateId,
      platformAgentAccountId,
      companionReleaseSha: releaseSha,
      companionArchiveSha256: archiveSha256,
      companionInstallationTreeSha256: installationTreeSha256,
      requestedAt: '2026-09-26T12:00:00.000Z',
      expiresAt: '2026-09-26T12:10:00.000Z',
    },
    currentIdentity: {
      pilotRevisionId,
      activationEpoch: '123',
      certificateId,
      platformAgentAccountId,
    },
    certificate: {
      certificateId,
      certificateBodyDigest,
      deviceKeyId: 'paired-device-key-v1',
      devicePublicKeySpki: publicKey.toString('base64url'),
      devicePublicKeySpkiSha256: `sha256:${createHash('sha256').update(publicKey).digest('hex')}`,
      validFrom: '2026-09-26T11:00:00.000Z',
      validUntil: '2026-09-26T20:00:00.000Z',
    },
    release: {
      releaseSha,
      archiveSha256,
      installationTreeSha256,
      observedAt: '2026-09-26T12:00:45.000Z',
    },
    process: { ...process, proof },
    assessedAt: '2026-09-26T12:01:10.000Z',
  };
}

describe('dormant companion activation evidence consistency', () => {
  it('matches one timely request to database identity, attested release, and DB-key-signed process', () => {
    expect(matchesCompanionActivationEvidence(fixture())).toBe(true);
  });

  it('rejects a different current pilot, epoch, account, or certificate', () => {
    const base = fixture();
    for (const currentIdentity of [
      { ...base.currentIdentity, pilotRevisionId: requestKey },
      { ...base.currentIdentity, activationEpoch: '124' },
      { ...base.currentIdentity, platformAgentAccountId: requestKey },
      { ...base.currentIdentity, certificateId: requestKey },
    ]) {
      expect(matchesCompanionActivationEvidence({ ...base, currentIdentity })).toBe(false);
    }
  });

  it('rejects changed request identity, release claims, and independent attestation', () => {
    const base = fixture();
    for (const request of [
      { ...base.request, requestKey: certificateId },
      { ...base.request, activationEpoch: '0' },
      { ...base.request, activationEpoch: '9223372036854775808' },
      { ...base.request, companionReleaseSha: 'f'.repeat(40) },
      { ...base.request, companionArchiveSha256: `sha256:${'f'.repeat(64)}` },
      { ...base.request, companionInstallationTreeSha256: `sha256:${'f'.repeat(64)}` },
    ]) {
      expect(matchesCompanionActivationEvidence({ ...base, request })).toBe(false);
    }
    expect(
      matchesCompanionActivationEvidence({
        ...base,
        release: { ...base.release, installationTreeSha256: `sha256:${'e'.repeat(64)}` },
      }),
    ).toBe(false);
  });

  it('rejects a local certificate, wrong database key, or altered signature', () => {
    const base = fixture();
    const otherPublicKey = Buffer.from(
      otherDevice.publicKey.export({ format: 'der', type: 'spki' }),
    );
    for (const certificate of [
      { ...base.certificate, certificateId: requestKey },
      { ...base.certificate, certificateBodyDigest: `sha256:${'f'.repeat(64)}` },
      { ...base.certificate, deviceKeyId: 'another-device-key-v1' },
      {
        ...base.certificate,
        devicePublicKeySpki: otherPublicKey.toString('base64url'),
        devicePublicKeySpkiSha256: `sha256:${createHash('sha256').update(otherPublicKey).digest('hex')}`,
      },
      { ...base.certificate, devicePublicKeySpkiSha256: `sha256:${'f'.repeat(64)}` },
    ]) {
      expect(matchesCompanionActivationEvidence({ ...base, certificate })).toBe(false);
    }
    expect(
      matchesCompanionActivationEvidence({
        ...base,
        process: {
          ...base.process,
          proof: { ...base.process.proof, signature: 'a'.repeat(86) },
        },
      }),
    ).toBe(false);
  });

  it('never treats a signed no-money diagnostic proof as activation evidence', () => {
    const base = fixture();
    const diagnostic = signCompanionLaunchProof(
      {
        challenge: base.process.challenge,
        certificateBodyDigest,
        deviceKeyId: base.certificate.deviceKeyId,
        devicePublicKeySpki: base.certificate.devicePublicKeySpki,
        releaseSha,
        installationTreeSha256,
        processId: base.process.processId,
        startedAt: base.process.startedAt,
        observedAt: base.process.observedAt,
      },
      device.privateKey,
    );
    expect(diagnostic).toBeDefined();
    expect(
      matchesCompanionActivationEvidence({
        ...base,
        process: { ...base.process, proof: diagnostic as never },
      }),
    ).toBe(false);
  });

  it('rejects expiry, future evidence, stale evidence, and a challenge before the request', () => {
    const base = fixture();
    for (const changed of [
      { ...base, assessedAt: base.request.expiresAt },
      { ...base, assessedAt: '2026-09-26T12:04:00.000Z' },
      {
        ...base,
        request: { ...base.request, expiresAt: '2026-09-26T12:10:00.001Z' },
      },
      {
        ...base,
        request: { ...base.request, requestedAt: '2026-09-26T12:02:00.000Z' },
      },
      {
        ...base,
        certificate: { ...base.certificate, validUntil: base.assessedAt },
      },
      {
        ...base,
        release: { ...base.release, observedAt: '2026-09-26T12:01:20.000Z' },
      },
      {
        ...base,
        process: { ...base.process, challengeIssuedAt: '2026-09-26T11:59:59.000Z' },
      },
      {
        ...base,
        process: { ...base.process, challengeIssuedAt: '2026-09-26T12:01:01.000Z' },
      },
      {
        ...base,
        process: { ...base.process, startedAt: '2026-09-26T11:59:59.000Z' },
      },
      {
        ...base,
        process: { ...base.process, startedAt: '2026-09-26T12:00:08.000Z' },
      },
      {
        ...base,
        assessedAt: '2026-09-26T12:02:16.000Z',
      },
    ]) {
      expect(matchesCompanionActivationEvidence(changed)).toBe(false);
    }
  });

  it('rejects a reused challenge/proof for another request or observed process', () => {
    const base = fixture();
    expect(
      matchesCompanionActivationEvidence({
        ...base,
        process: { ...base.process, requestKey: certificateId },
      }),
    ).toBe(false);
    expect(
      matchesCompanionActivationEvidence({
        ...base,
        process: { ...base.process, processId: 4243 },
      }),
    ).toBe(false);
    expect(
      matchesCompanionActivationEvidence({
        ...base,
        process: { ...base.process, challenge: Buffer.alloc(32, 0x3e).toString('base64url') },
      }),
    ).toBe(false);
    expect(
      matchesCompanionActivationEvidence({
        ...base,
        process: { ...base.process, executionHandoffSha256: `sha256:${'f'.repeat(64)}` },
      }),
    ).toBe(false);
  });
});
