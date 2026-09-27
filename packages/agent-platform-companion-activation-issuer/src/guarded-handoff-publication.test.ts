import { createHash, generateKeyPairSync, randomUUID, verify } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

import {
  COMPANION_EXECUTION_ACTIVATION_HANDOFF_PURPOSE,
  type CompanionActivationCertificateSnapshot,
  type CompanionActivationReleaseAttestation,
  type CompanionActivationRequestSnapshot,
} from '@fetanagent/agent-platform-companion-execution-contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  GuardedCompanionHandoffPublicationUnavailableError,
  publishGuardedCompanionHandoffWithSigner,
  type GuardedCompanionHandoffPublicationInputs,
} from './guarded-handoff-publication.js';

const signer = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const signerSpki = Buffer.from(signer.publicKey.export({ format: 'der', type: 'spki' }));
const deviceSpki = Buffer.from(device.publicKey.export({ format: 'der', type: 'spki' }));
const trustedSigner = {
  keyId: 'test-execution-signer-v1',
  publicKeySpkiSha256: `sha256:${createHash('sha256').update(signerSpki).digest('hex')}`,
};
const request: CompanionActivationRequestSnapshot = {
  requestKey: randomUUID(),
  pilotRevisionId: randomUUID(),
  activationEpoch: '2',
  certificateId: randomUUID(),
  platformAgentAccountId: randomUUID(),
  companionReleaseSha: 'a'.repeat(40),
  companionArchiveSha256: `sha256:${'b'.repeat(64)}`,
  companionInstallationTreeSha256: `sha256:${'c'.repeat(64)}`,
  requestedAt: '2026-09-26T11:59:00.000Z',
  expiresAt: '2026-09-26T12:09:00.000Z',
};
const certificate: CompanionActivationCertificateSnapshot = {
  certificateId: request.certificateId,
  certificateBodyDigest: `sha256:${'d'.repeat(64)}`,
  deviceKeyId: 'test-device-key-01',
  devicePublicKeySpki: deviceSpki.toString('base64url'),
  devicePublicKeySpkiSha256: `sha256:${createHash('sha256').update(deviceSpki).digest('hex')}`,
  validFrom: '2026-09-26T11:00:00.000Z',
  validUntil: '2026-09-26T13:00:00.000Z',
};
const release: CompanionActivationReleaseAttestation = {
  releaseSha: request.companionReleaseSha,
  archiveSha256: request.companionArchiveSha256,
  installationTreeSha256: request.companionInstallationTreeSha256,
  observedAt: '2026-09-26T11:59:40.000Z',
};
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(): Promise<GuardedCompanionHandoffPublicationInputs> {
  const root = await mkdtemp(resolve(tmpdir(), 'fetanagent-handoff-publication-'));
  roots.push(root);
  const dataRoot = resolve(root, 'data');
  await mkdir(resolve(dataRoot, 'execution-v2'), { recursive: true });
  return {
    request,
    currentIdentity: {
      pilotRevisionId: request.pilotRevisionId,
      activationEpoch: request.activationEpoch,
      certificateId: request.certificateId,
      platformAgentAccountId: request.platformAgentAccountId,
    },
    certificate,
    release,
    dataRoot,
    signerPrivateKey: signer.privateKey,
    trustedNow: () => new Date('2026-09-26T12:00:00.000Z'),
  };
}

function fileFor(input: GuardedCompanionHandoffPublicationInputs): string {
  return resolve(input.dataRoot, 'execution-v2', 'activation-handoff.v1.json');
}

async function unavailable(input: GuardedCompanionHandoffPublicationInputs): Promise<void> {
  await expect(publishGuardedCompanionHandoffWithSigner(input, trustedSigner)).rejects.toThrow(
    GuardedCompanionHandoffPublicationUnavailableError,
  );
}

describe('guarded companion handoff publication', () => {
  it('publishes exactly one canonical request-bound handoff without returning its contents', async () => {
    const input = await fixture();
    const result = await publishGuardedCompanionHandoffWithSigner(input, trustedSigner);
    const raw = await readFile(fileFor(input), 'utf8');
    const envelope = JSON.parse(raw);
    expect(raw).toBe(JSON.stringify(envelope));
    expect(Object.keys(result)).toEqual(['handoffSha256', 'expiresAt']);
    expect(result.handoffSha256).toBe(`sha256:${createHash('sha256').update(raw).digest('hex')}`);
    expect(result.expiresAt).toBe(request.expiresAt);
    expect(envelope.signerKeyId).toBe(trustedSigner.keyId);
    expect(envelope.body).toEqual({
      contractVersion: 1,
      purpose: COMPANION_EXECUTION_ACTIVATION_HANDOFF_PURPOSE,
      deploymentTarget: 'production',
      requestKey: request.requestKey,
      activationEpoch: request.activationEpoch,
      platformAgentAccountId: request.platformAgentAccountId,
      noMoneyCertificateBodyDigest: certificate.certificateBodyDigest,
      companionReleaseSha: release.releaseSha,
      companionArchiveSha256: release.archiveSha256,
      companionInstallationTreeSha256: release.installationTreeSha256,
      issuedAt: '2026-09-26T12:00:00.000Z',
      notBefore: '2026-09-26T12:00:00.000Z',
      expiresAt: request.expiresAt,
    });
    expect(
      verify(
        'sha256',
        Buffer.from(
          `${COMPANION_EXECUTION_ACTIVATION_HANDOFF_PURPOSE}\0${JSON.stringify(envelope.body)}`,
        ),
        { key: signer.publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(envelope.signature, 'base64url'),
      ),
    ).toBe(true);
  });

  it('never overwrites an existing handoff or treats publication as retryable', async () => {
    const input = await fixture();
    await writeFile(fileFor(input), 'existing-handoff', { flag: 'wx' });
    await unavailable(input);
    expect(await readFile(fileFor(input), 'utf8')).toBe('existing-handoff');
  });

  it('rejects expired requests, stale release evidence, and mismatched independent bindings', async () => {
    const input = await fixture();
    await unavailable({ ...input, trustedNow: () => new Date(request.expiresAt) });
    await unavailable({
      ...input,
      trustedNow: () => new Date('2026-09-26T12:02:00.000Z'),
    });
    await unavailable({
      ...input,
      release: { ...release, archiveSha256: `sha256:${'f'.repeat(64)}` },
    });
    await unavailable({ ...input, certificate: { ...certificate, certificateId: randomUUID() } });
    await unavailable({
      ...input,
      certificate: { ...certificate, devicePublicKeySpkiSha256: `sha256:${'e'.repeat(64)}` },
    });
    await unavailable({
      ...input,
      currentIdentity: { ...input.currentIdentity, pilotRevisionId: randomUUID() },
    });
    await unavailable({ ...input, request: { ...request, activationEpoch: '0' } });
    await expect(readFile(fileFor(input))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('never extends the handoff past certificate validity', async () => {
    const input = await fixture();
    const shorterCertificate = {
      ...certificate,
      validUntil: '2026-09-26T12:01:00.000Z',
    };
    const result = await publishGuardedCompanionHandoffWithSigner(
      { ...input, certificate: shorterCertificate },
      trustedSigner,
    );
    expect(result.expiresAt).toBe(shorterCertificate.validUntil);
    const envelope = JSON.parse(await readFile(fileFor(input), 'utf8'));
    expect(envelope.body.expiresAt).toBe(shorterCertificate.validUntil);
  });

  it('requires an existing canonical directory and the expected signing key', async () => {
    const input = await fixture();
    await unavailable({ ...input, dataRoot: `${input.dataRoot}${sep}..${sep}data` });
    await unavailable({ ...input, dataRoot: resolve(input.dataRoot, 'absent') });
    await unavailable({
      ...input,
      signerPrivateKey: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey,
    });
    await expect(readFile(fileFor(input))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
