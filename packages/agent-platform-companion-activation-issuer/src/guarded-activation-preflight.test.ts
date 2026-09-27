import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';

import {
  signCompanionExecutionLaunchProof,
  type CompanionActivationDatabaseSnapshot,
  type CompanionActivationReleaseAttestation,
} from '@fetanagent/agent-platform-companion-execution-contracts';
import { describe, expect, it } from 'vitest';

import {
  GuardedCompanionActivationPreflightUnavailableError,
  rehearseGuardedCompanionActivationWithAdapters,
  type GuardedCompanionActivationPreflightInputs,
} from './guarded-activation-preflight.js';

const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const signer = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const deviceSpki = Buffer.from(device.publicKey.export({ format: 'der', type: 'spki' }));
const handoffSha256 = `sha256:${'e'.repeat(64)}`;
const requestKey = randomUUID();
const pilotRevisionId = randomUUID();
const certificateId = randomUUID();
const platformAgentAccountId = randomUUID();
const snapshot: CompanionActivationDatabaseSnapshot = {
  request: {
    requestKey,
    pilotRevisionId,
    activationEpoch: '3',
    certificateId,
    platformAgentAccountId,
    companionReleaseSha: 'a'.repeat(40),
    companionArchiveSha256: `sha256:${'b'.repeat(64)}`,
    companionInstallationTreeSha256: `sha256:${'c'.repeat(64)}`,
    requestedAt: '2026-09-26T11:59:00.000Z',
    expiresAt: '2026-09-26T12:09:00.000Z',
  },
  currentIdentity: {
    pilotRevisionId,
    activationEpoch: '3',
    certificateId,
    platformAgentAccountId,
  },
  certificate: {
    certificateId,
    certificateBodyDigest: `sha256:${'d'.repeat(64)}`,
    deviceKeyId: 'test-device-key-01',
    devicePublicKeySpki: deviceSpki.toString('base64url'),
    devicePublicKeySpkiSha256: `sha256:${createHash('sha256').update(deviceSpki).digest('hex')}`,
    validFrom: '2026-09-26T11:00:00.000Z',
    validUntil: '2026-09-26T15:00:00.000Z',
  },
};

const release: CompanionActivationReleaseAttestation = {
  releaseSha: snapshot.request.companionReleaseSha,
  archiveSha256: snapshot.request.companionArchiveSha256,
  installationTreeSha256: snapshot.request.companionInstallationTreeSha256,
  observedAt: '2026-09-26T12:00:00.000Z',
};

function fixture() {
  const events: string[] = [];
  let resolveStopped!: () => void;
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });
  const input: GuardedCompanionActivationPreflightInputs = {
    requestKey,
    administrator: { query: async () => ({ rows: [] }) },
    releaseInputs: {
      releaseTag: 'windows-companion-v-test',
      archivePath: 'C:\\reviewed\\archive.zip',
      checksumPath: 'C:\\reviewed\\SHA256SUMS',
      installationRoot: 'C:\\reviewed\\installed',
      verifierScriptPath: 'C:\\reviewed\\verify-windows-companion-release-installation.ps1',
      powershellExecutable: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    },
    dataRoot: 'C:\\protected\\companion-data',
    processVerifierScriptPath: 'C:\\reviewed\\inspect-guarded-windows-companion-process.ps1',
    windowsEnvironment: {},
    signerPrivateKey: signer.privateKey,
    trustedNow: () => new Date('2026-09-26T12:00:00.000Z'),
  };
  let secondSnapshot: CompanionActivationDatabaseSnapshot = snapshot;
  let observedDigest = handoffSha256;
  let stopFailure = false;
  let closeFailure = false;
  const adapters = {
    loadSnapshot: async () => {
      events.push('snapshot');
      return events.filter((event) => event === 'snapshot').length === 1
        ? snapshot
        : secondSnapshot;
    },
    verifyRelease: async () => {
      events.push('release');
      return release;
    },
    publishHandoff: async () => {
      events.push('handoff');
      return { handoffSha256, expiresAt: '2026-09-26T14:09:00.000Z' };
    },
    openChannel: async () => {
      events.push('channel-open');
      return {
        pipePath: '\\\\.\\pipe\\fetanagent-companion-launch-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        receiveProof: async () => {
          events.push('proof-received');
          return { opaque: 'proof only for the independent observer' };
        },
        close: async () => {
          events.push('channel-close');
          if (closeFailure) throw new Error('do not expose this');
        },
      };
    },
    start: () => {
      events.push('child-start');
      return {
        processId: 1234,
        stopped,
        stop: async () => {
          events.push('child-stop');
          if (stopFailure) throw new Error('do not expose this');
          resolveStopped();
        },
        stopAfterPermit: async () => {
          throw new Error('must never request a post-permit stop in this rehearsal');
        },
      };
    },
    observe: async (observation: { challenge: string; challengeIssuedAt: string }) => {
      events.push('observed');
      const proof = signCompanionExecutionLaunchProof(
        {
          challenge: observation.challenge,
          certificateBodyDigest: snapshot.certificate.certificateBodyDigest,
          deviceKeyId: snapshot.certificate.deviceKeyId,
          devicePublicKeySpki: snapshot.certificate.devicePublicKeySpki,
          releaseSha: release.releaseSha,
          installationTreeSha256: release.installationTreeSha256,
          requestKey,
          activationEpoch: snapshot.request.activationEpoch,
          platformAgentAccountId: snapshot.request.platformAgentAccountId,
          executionHandoffSha256: observedDigest,
          processId: 1234,
          startedAt: '2026-09-26T11:59:59.000Z',
          observedAt: '2026-09-26T12:00:00.000Z',
        },
        device.privateKey,
      );
      if (!proof) throw new Error('test proof');
      expect(observation.challengeIssuedAt).toBe('2026-09-26T12:00:00.000Z');
      return {
        processId: 1234,
        startedAt: '2026-09-26T11:59:59.000Z',
        observedAt: '2026-09-26T12:00:00.000Z',
        executionHandoffSha256: observedDigest,
        proof,
      };
    },
  };
  return {
    input,
    adapters,
    events,
    changeSnapshot: (value: CompanionActivationDatabaseSnapshot) => {
      secondSnapshot = value;
    },
    changeObservedDigest: (value: string) => {
      observedDigest = value;
    },
    failStop: () => {
      stopFailure = true;
    },
    failClose: () => {
      closeFailure = true;
    },
  };
}

describe('guarded no-permit activation preflight', () => {
  it('binds two identical database snapshots to release, handoff, signed proof, and clean exact-child exit', async () => {
    const f = fixture();
    const result = await rehearseGuardedCompanionActivationWithAdapters(f.input, f.adapters);
    expect(result).toEqual({
      releaseVerified: true,
      signedHandoffPublished: true,
      pairedProcessObserved: true,
      exactHostStopped: true,
      permitSent: false,
      databaseTransitionInvoked: false,
      attestationRetained: false,
    });
    expect(f.events).toEqual([
      'snapshot',
      'release',
      'handoff',
      'channel-open',
      'child-start',
      'proof-received',
      'observed',
      'snapshot',
      'child-stop',
      'channel-close',
    ]);
  });

  it('stops the exact child and closes the no-permit channel on a changed database identity', async () => {
    const f = fixture();
    f.changeSnapshot({
      ...snapshot,
      currentIdentity: { ...snapshot.currentIdentity, activationEpoch: '4' },
    });
    await expect(
      rehearseGuardedCompanionActivationWithAdapters(f.input, f.adapters),
    ).rejects.toThrow(GuardedCompanionActivationPreflightUnavailableError);
    expect(f.events.slice(-2)).toEqual(['child-stop', 'channel-close']);
  });

  it('refuses a proof bound to a different local handoff digest', async () => {
    const f = fixture();
    f.changeObservedDigest(`sha256:${'f'.repeat(64)}`);
    await expect(
      rehearseGuardedCompanionActivationWithAdapters(f.input, f.adapters),
    ).rejects.toThrow(GuardedCompanionActivationPreflightUnavailableError);
    expect(f.events.filter((event) => event === 'snapshot')).toHaveLength(1);
    expect(f.events.slice(-2)).toEqual(['child-stop', 'channel-close']);
  });

  it('never reports success if host shutdown or channel closure is unconfirmed', async () => {
    const host = fixture();
    host.failStop();
    await expect(
      rehearseGuardedCompanionActivationWithAdapters(host.input, host.adapters),
    ).rejects.toThrow(GuardedCompanionActivationPreflightUnavailableError);
    expect(host.events).toContain('channel-close');
    const channel = fixture();
    channel.failClose();
    await expect(
      rehearseGuardedCompanionActivationWithAdapters(channel.input, channel.adapters),
    ).rejects.toThrow(GuardedCompanionActivationPreflightUnavailableError);
    expect(channel.events).toContain('child-stop');
  });

  it('rejects malformed or aborted input before any side effect', async () => {
    const f = fixture();
    await expect(
      rehearseGuardedCompanionActivationWithAdapters(
        { ...f.input, requestKey: 'invalid' },
        f.adapters,
      ),
    ).rejects.toThrow(GuardedCompanionActivationPreflightUnavailableError);
    const controller = new AbortController();
    controller.abort();
    await expect(
      rehearseGuardedCompanionActivationWithAdapters(
        { ...f.input, signal: controller.signal },
        f.adapters,
      ),
    ).rejects.toThrow(GuardedCompanionActivationPreflightUnavailableError);
    expect(f.events).toEqual([]);
  });
});
