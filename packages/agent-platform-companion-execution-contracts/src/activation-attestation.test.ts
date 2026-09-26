import { createHash, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  CompanionActivationAttestationUnavailableError,
  retainCompanionActivationAttestation,
  type CompanionActivationAttestation,
  type CompanionActivationAttestationSources,
  type CompanionActivationDatabaseSnapshot,
} from './activation-attestation.js';
import { signCompanionExecutionLaunchProof } from './launch-proof.js';

const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const publicKey = Buffer.from(device.publicKey.export({ format: 'der', type: 'spki' }));
const requestKey = '11111111-1111-4111-8111-111111111111';
const certificateBodyDigest = `sha256:${'a'.repeat(64)}`;
const releaseSha = 'b'.repeat(40);
const archiveSha256 = `sha256:${'c'.repeat(64)}`;
const installationTreeSha256 = `sha256:${'d'.repeat(64)}`;
const executionHandoffSha256 = `sha256:${'e'.repeat(64)}`;

function databaseSnapshot(): CompanionActivationDatabaseSnapshot {
  return {
    request: {
      requestKey,
      pilotRevisionId: '22222222-2222-4222-8222-222222222222',
      activationEpoch: '123',
      certificateId: '33333333-3333-4333-8333-333333333333',
      platformAgentAccountId: '44444444-4444-4444-8444-444444444444',
      companionReleaseSha: releaseSha,
      companionArchiveSha256: archiveSha256,
      companionInstallationTreeSha256: installationTreeSha256,
      requestedAt: '2026-09-26T12:00:00.000Z',
      expiresAt: '2026-09-26T12:10:00.000Z',
    },
    currentIdentity: {
      pilotRevisionId: '22222222-2222-4222-8222-222222222222',
      activationEpoch: '123',
      certificateId: '33333333-3333-4333-8333-333333333333',
      platformAgentAccountId: '44444444-4444-4444-8444-444444444444',
    },
    certificate: {
      certificateId: '33333333-3333-4333-8333-333333333333',
      certificateBodyDigest,
      deviceKeyId: 'paired-device-key-v1',
      devicePublicKeySpki: publicKey.toString('base64url'),
      devicePublicKeySpkiSha256: `sha256:${createHash('sha256').update(publicKey).digest('hex')}`,
      validFrom: '2026-09-26T11:00:00.000Z',
      validUntil: '2026-09-26T20:00:00.000Z',
    },
  };
}

function sources(): {
  readonly dependencies: CompanionActivationAttestationSources;
  readonly retain: ReturnType<typeof vi.fn<(row: CompanionActivationAttestation) => Promise<void>>>;
  readonly load: ReturnType<
    typeof vi.fn<(key: string) => Promise<CompanionActivationDatabaseSnapshot>>
  >;
  readonly verifyRelease: ReturnType<
    typeof vi.fn<CompanionActivationAttestationSources['verifyPublishedReleaseAndInstalledTree']>
  >;
  readonly observe: ReturnType<
    typeof vi.fn<CompanionActivationAttestationSources['observePairedProcess']>
  >;
} {
  const load = vi.fn(async () => databaseSnapshot());
  const verifyRelease = vi.fn(async () => ({
    releaseSha,
    archiveSha256,
    installationTreeSha256,
    observedAt: '2026-09-26T12:00:10.000Z',
  }));
  const observe = vi.fn(
    async ({
      challenge,
    }: Parameters<CompanionActivationAttestationSources['observePairedProcess']>[0]) => {
      const processId = 4242;
      const startedAt = '2026-09-26T12:00:35.000Z';
      const observedAt = '2026-09-26T12:00:40.000Z';
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
          platformAgentAccountId: '44444444-4444-4444-8444-444444444444',
          executionHandoffSha256,
          processId,
          startedAt,
          observedAt,
        },
        device.privateKey,
      );
      if (!proof) throw new Error('Test proof could not be signed');
      return { processId, startedAt, observedAt, executionHandoffSha256, proof };
    },
  );
  const retain = vi.fn(async (_row: CompanionActivationAttestation) => undefined);
  let clockReads = 0;
  const dependencies: CompanionActivationAttestationSources = {
    loadDatabaseSnapshot: load,
    verifyPublishedReleaseAndInstalledTree: verifyRelease,
    observePairedProcess: observe,
    retainAttestation: retain,
    trustedNow: () =>
      new Date(clockReads++ === 0 ? '2026-09-26T12:00:30.000Z' : '2026-09-26T12:00:50.000Z'),
  };
  return { dependencies, retain, load, verifyRelease, observe };
}

describe('non-activating companion activation attestation issuer core', () => {
  it('uses a fresh generated challenge, rereads database identity, and retains only digests', async () => {
    const fixture = sources();
    await retainCompanionActivationAttestation(requestKey, fixture.dependencies);

    expect(fixture.load).toHaveBeenCalledTimes(2);
    expect(fixture.verifyRelease).toHaveBeenCalledTimes(1);
    expect(fixture.observe).toHaveBeenCalledTimes(1);
    expect(fixture.retain).toHaveBeenCalledTimes(1);
    const challenge = fixture.observe.mock.calls[0]![0].challenge;
    const row = fixture.retain.mock.calls[0]![0];
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(row).toMatchObject({
      requestKey,
      certificateBodyDigest,
      companionReleaseSha: releaseSha,
      companionArchiveSha256: archiveSha256,
      companionInstallationTreeSha256: installationTreeSha256,
      executionHandoffSha256,
      challengeDigest: `sha256:${createHash('sha256').update(Buffer.from(challenge, 'base64url')).digest('hex')}`,
      processId: 4242,
      verifiedAt: '2026-09-26T12:00:50.000Z',
    });
    expect(row.launchProofDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(JSON.stringify(row)).not.toContain(challenge);
    expect(JSON.stringify(row)).not.toContain('signature');
  });

  it('rejects a malformed request without touching a trust source', async () => {
    const fixture = sources();
    await expect(
      retainCompanionActivationAttestation('not-a-request-key', fixture.dependencies),
    ).rejects.toThrow(CompanionActivationAttestationUnavailableError);
    expect(fixture.load).not.toHaveBeenCalled();
    expect(fixture.retain).not.toHaveBeenCalled();
  });

  it('does not retain a witness when the independent release disagrees', async () => {
    const fixture = sources();
    fixture.verifyRelease.mockResolvedValueOnce({
      releaseSha,
      archiveSha256: `sha256:${'e'.repeat(64)}`,
      installationTreeSha256,
      observedAt: '2026-09-26T12:00:10.000Z',
    });
    await expect(
      retainCompanionActivationAttestation(requestKey, fixture.dependencies),
    ).rejects.toThrow(CompanionActivationAttestationUnavailableError);
    expect(fixture.retain).not.toHaveBeenCalled();
  });

  it('does not retain a witness if database identity changes during observation', async () => {
    const fixture = sources();
    fixture.load.mockResolvedValueOnce(databaseSnapshot());
    fixture.load.mockResolvedValueOnce({
      ...databaseSnapshot(),
      currentIdentity: { ...databaseSnapshot().currentIdentity, activationEpoch: '124' },
    });
    await expect(
      retainCompanionActivationAttestation(requestKey, fixture.dependencies),
    ).rejects.toThrow(CompanionActivationAttestationUnavailableError);
    expect(fixture.retain).not.toHaveBeenCalled();
  });

  it('does not retain a witness if the paired-process proof is altered', async () => {
    const fixture = sources();
    const original = fixture.observe.getMockImplementation();
    if (!original) throw new Error('The test observer is missing');
    fixture.observe.mockImplementationOnce(async (input) => {
      const observed = await original(input);
      return { ...observed, proof: { ...observed.proof, signature: 'a'.repeat(86) } };
    });
    await expect(
      retainCompanionActivationAttestation(requestKey, fixture.dependencies),
    ).rejects.toThrow(CompanionActivationAttestationUnavailableError);
    expect(fixture.retain).not.toHaveBeenCalled();
  });

  it('rejects a process identifier outside the database integer domain', async () => {
    const fixture = sources();
    const original = fixture.observe.getMockImplementation();
    if (!original) throw new Error('The test observer is missing');
    fixture.observe.mockImplementationOnce(async (input) => ({
      ...(await original(input)),
      processId: 2_147_483_648,
    }));
    await expect(
      retainCompanionActivationAttestation(requestKey, fixture.dependencies),
    ).rejects.toThrow(CompanionActivationAttestationUnavailableError);
    expect(fixture.retain).not.toHaveBeenCalled();
  });

  it('does not retain stale evidence or leak adapter failures', async () => {
    const fixture = sources();
    await expect(
      retainCompanionActivationAttestation(requestKey, {
        ...fixture.dependencies,
        trustedNow: () => new Date('2026-09-26T12:04:00.000Z'),
      }),
    ).rejects.toThrow('The companion activation attestation is unavailable.');
    expect(fixture.retain).not.toHaveBeenCalled();

    const failed = sources();
    failed.verifyRelease.mockRejectedValueOnce(new Error('sensitive adapter failure'));
    await expect(
      retainCompanionActivationAttestation(requestKey, failed.dependencies),
    ).rejects.not.toThrow('sensitive adapter failure');
    expect(failed.retain).not.toHaveBeenCalled();
  });
});
