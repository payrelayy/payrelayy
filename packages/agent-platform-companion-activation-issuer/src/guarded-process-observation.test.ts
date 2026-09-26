import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  COMPANION_EXECUTION_ACTIVATION_HANDOFF_PURPOSE,
  signCompanionExecutionActivationHandoff,
  signCompanionExecutionLaunchProof,
  signCompanionLaunchProof,
  type CompanionActivationCertificateSnapshot,
  type CompanionActivationReleaseAttestation,
  type CompanionActivationRequestSnapshot,
} from '@fetanagent/agent-platform-companion-execution-contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  GuardedCompanionProcessObservationUnavailableError,
  observeGuardedWindowsCompanionProcessWithReader,
  type GuardedCompanionProcessObservationInputs,
} from './guarded-process-observation.js';

const signer = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const signerSpki = Buffer.from(signer.publicKey.export({ format: 'der', type: 'spki' }));
const deviceSpki = Buffer.from(device.publicKey.export({ format: 'der', type: 'spki' }));
const trustedSigner = {
  keyId: 'test-execution-signer-v1',
  publicKeySpki: signerSpki.toString('base64url'),
  publicKeySpkiSha256: `sha256:${createHash('sha256').update(signerSpki).digest('hex')}`,
};
const now = new Date('2026-09-26T12:00:03.000Z');
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
  validUntil: '2026-09-27T00:00:00.000Z',
};
const release: CompanionActivationReleaseAttestation = {
  releaseSha: request.companionReleaseSha,
  archiveSha256: request.companionArchiveSha256,
  installationTreeSha256: request.companionInstallationTreeSha256,
  observedAt: '2026-09-26T11:59:40.000Z',
};
const script = fileURLToPath(
  new URL(
    '../../../infra/operations/inspect-guarded-windows-companion-process.ps1',
    import.meta.url,
  ),
);
const temporaryRoots: string[] = [];
afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(): Promise<GuardedCompanionProcessObservationInputs> {
  const root = await mkdtemp(resolve(tmpdir(), 'fetanagent-guarded-observation-'));
  temporaryRoots.push(root);
  const dataRoot = resolve(root, 'data');
  await mkdir(resolve(dataRoot, 'execution-v2'), { recursive: true });
  const handoff = signCompanionExecutionActivationHandoff(
    {
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
      issuedAt: '2026-09-26T11:59:00.000Z',
      notBefore: '2026-09-26T11:59:00.000Z',
      expiresAt: '2026-09-26T23:59:00.000Z',
    },
    signer.privateKey,
    trustedSigner.keyId,
    trustedSigner.publicKeySpkiSha256,
  );
  expect(handoff).toBeDefined();
  const raw = JSON.stringify(handoff);
  await writeFile(resolve(dataRoot, 'execution-v2', 'activation-handoff.v1.json'), raw);
  const handoffSha256 = `sha256:${createHash('sha256').update(raw).digest('hex')}`;
  const challenge = randomBytes(32).toString('base64url');
  const proof = signCompanionExecutionLaunchProof(
    {
      challenge,
      certificateBodyDigest: certificate.certificateBodyDigest,
      deviceKeyId: certificate.deviceKeyId,
      devicePublicKeySpki: certificate.devicePublicKeySpki,
      releaseSha: release.releaseSha,
      installationTreeSha256: release.installationTreeSha256,
      requestKey: request.requestKey,
      activationEpoch: request.activationEpoch,
      platformAgentAccountId: request.platformAgentAccountId,
      executionHandoffSha256: handoffSha256,
      processId: 1234,
      startedAt: '2026-09-26T11:59:59.000Z',
      observedAt: '2026-09-26T12:00:02.000Z',
    },
    device.privateKey,
  );
  expect(proof).toBeDefined();
  return {
    request,
    certificate,
    release,
    dataRoot,
    installationRoot: resolve(root, 'installed'),
    proof,
    challenge,
    challengeIssuedAt: '2026-09-26T12:00:00.000Z',
    powershellExecutable: resolve(root, 'pwsh.exe'),
    verifierScriptPath: script,
    trustedNow: () => now,
  };
}

const OS_SUCCESS = 'COMPANION_GUARDED_OS_PROCESS_OBSERVED|1234|2026-09-26T11:59:59.500Z';

describe('guarded Windows companion process observation', () => {
  it('checks the canonical signed handoff, paired v2 proof, and independently queried OS process', async () => {
    const input = await fixture();
    let calls = 0;
    const result = await observeGuardedWindowsCompanionProcessWithReader(
      input,
      async (executable, arguments_) => {
        calls += 1;
        expect(executable).toBe(input.powershellExecutable);
        expect(arguments_).toContain(script);
        expect(arguments_).toContain('1234');
        expect(arguments_).not.toContain(input.request.requestKey);
        expect(arguments_).not.toContain(input.challenge);
        return OS_SUCCESS;
      },
      trustedSigner,
    );
    expect(calls).toBe(1);
    expect(result.processId).toBe(1234);
    const rawHandoff = await readFile(
      resolve(input.dataRoot, 'execution-v2', 'activation-handoff.v1.json'),
      'utf8',
    );
    expect(result.executionHandoffSha256).toBe(
      `sha256:${createHash('sha256').update(rawHandoff).digest('hex')}`,
    );
    expect(result.proof).toBe(input.proof);
  });

  it('rejects a tampered handoff before reading the process', async () => {
    const input = await fixture();
    const file = resolve(input.dataRoot, 'execution-v2', 'activation-handoff.v1.json');
    const raw = await readFile(file, 'utf8');
    await writeFile(file, raw.replace(request.requestKey, randomUUID()));
    let calls = 0;
    await expect(
      observeGuardedWindowsCompanionProcessWithReader(
        input,
        async () => {
          calls += 1;
          return OS_SUCCESS;
        },
        trustedSigner,
      ),
    ).rejects.toBeInstanceOf(GuardedCompanionProcessObservationUnavailableError);
    expect(calls).toBe(0);
  });

  it('rejects a different signer or challenge before reading the process', async () => {
    const input = await fixture();
    let calls = 0;
    const reader = async () => {
      calls += 1;
      return OS_SUCCESS;
    };
    await expect(
      observeGuardedWindowsCompanionProcessWithReader(input, reader, {
        ...trustedSigner,
        keyId: 'another-signer',
      }),
    ).rejects.toBeInstanceOf(GuardedCompanionProcessObservationUnavailableError);
    await expect(
      observeGuardedWindowsCompanionProcessWithReader(
        { ...input, challenge: randomBytes(32).toString('base64url') },
        reader,
        trustedSigner,
      ),
    ).rejects.toBeInstanceOf(GuardedCompanionProcessObservationUnavailableError);
    expect(calls).toBe(0);
  });

  it('rejects a no-money v1 proof and an OS PID or start-time mismatch', async () => {
    const input = await fixture();
    const v1 = signCompanionLaunchProof(
      {
        challenge: input.challenge,
        certificateBodyDigest: certificate.certificateBodyDigest,
        deviceKeyId: certificate.deviceKeyId,
        devicePublicKeySpki: certificate.devicePublicKeySpki,
        releaseSha: release.releaseSha,
        installationTreeSha256: release.installationTreeSha256,
        processId: 1234,
        startedAt: '2026-09-26T11:59:59.000Z',
        observedAt: '2026-09-26T12:00:02.000Z',
      },
      device.privateKey,
    );
    let calls = 0;
    await expect(
      observeGuardedWindowsCompanionProcessWithReader(
        { ...input, proof: v1 },
        async () => {
          calls += 1;
          return OS_SUCCESS;
        },
        trustedSigner,
      ),
    ).rejects.toBeInstanceOf(GuardedCompanionProcessObservationUnavailableError);
    expect(calls).toBe(0);
    for (const output of [
      'COMPANION_GUARDED_OS_PROCESS_OBSERVED|1235|2026-09-26T11:59:59.500Z',
      'COMPANION_GUARDED_OS_PROCESS_OBSERVED|1234|2026-09-26T11:59:45.000Z',
    ]) {
      await expect(
        observeGuardedWindowsCompanionProcessWithReader(input, async () => output, trustedSigner),
      ).rejects.toBeInstanceOf(GuardedCompanionProcessObservationUnavailableError);
    }
  });

  it('fails closed when the request has expired or the reviewed script changes', async () => {
    const input = await fixture();
    await expect(
      observeGuardedWindowsCompanionProcessWithReader(
        { ...input, trustedNow: () => new Date(request.expiresAt) },
        async () => OS_SUCCESS,
        trustedSigner,
      ),
    ).rejects.toBeInstanceOf(GuardedCompanionProcessObservationUnavailableError);
    await expect(
      observeGuardedWindowsCompanionProcessWithReader(
        {
          ...input,
          verifierScriptPath: resolve(input.dataRoot, 'execution-v2', 'activation-handoff.v1.json'),
        },
        async () => OS_SUCCESS,
        trustedSigner,
      ),
    ).rejects.toBeInstanceOf(GuardedCompanionProcessObservationUnavailableError);
  });
});
