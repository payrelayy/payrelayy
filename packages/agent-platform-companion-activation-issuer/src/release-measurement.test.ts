import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import type { CompanionActivationRequestSnapshot } from '@fetanagent/agent-platform-companion-execution-contracts';
import { describe, expect, it } from 'vitest';

import {
  CompanionActivationReleaseUnavailableError,
  verifyPublishedCompanionReleaseAndInstalledTreeWithRunner,
  type CompanionActivationReleaseInputs,
} from './release-measurement.js';

const now = new Date();
const request: CompanionActivationRequestSnapshot = {
  requestKey: randomUUID(),
  pilotRevisionId: randomUUID(),
  activationEpoch: '1',
  certificateId: randomUUID(),
  platformAgentAccountId: randomUUID(),
  companionReleaseSha: 'a'.repeat(40),
  companionArchiveSha256: `sha256:${'b'.repeat(64)}`,
  companionInstallationTreeSha256: `sha256:${'c'.repeat(64)}`,
  requestedAt: new Date(now.getTime() - 60_000).toISOString(),
  expiresAt: new Date(now.getTime() + 540_000).toISOString(),
};
const script = fileURLToPath(
  new URL(
    '../../../infra/operations/verify-windows-companion-release-installation.ps1',
    import.meta.url,
  ),
);
const inputs: CompanionActivationReleaseInputs = {
  releaseTag: 'windows-companion-v0.1.10',
  archivePath: fileURLToPath(new URL('../fixture-release.zip', import.meta.url)),
  checksumPath: fileURLToPath(new URL('../fixture-release.zip.sha256', import.meta.url)),
  installationRoot: fileURLToPath(new URL('../fixture-installation', import.meta.url)),
  verifierScriptPath: script,
  powershellExecutable: fileURLToPath(new URL('../pwsh.exe', import.meta.url)),
  trustedNow: () => now,
};

const VERIFIED_OUTPUT = 'COMPANION_RELEASE_INSTALLATION_VERIFIED; no activation was performed.';

describe('companion release measurement adapter', () => {
  it('accepts only the pinned preflight success and returns the verified request claims', async () => {
    let calls = 0;
    const result = await verifyPublishedCompanionReleaseAndInstalledTreeWithRunner(
      request,
      inputs,
      async (executable, arguments_) => {
        calls += 1;
        expect(executable).toBe(inputs.powershellExecutable);
        expect(arguments_).toContain(script);
        expect(arguments_).toContain(request.companionReleaseSha);
        expect(arguments_).toContain(request.companionArchiveSha256);
        expect(arguments_).toContain(request.companionInstallationTreeSha256);
        expect(arguments_).not.toContain(request.requestKey);
        expect(arguments_).not.toContain(request.certificateId);
        return `${VERIFIED_OUTPUT}\n`;
      },
    );
    expect(calls).toBe(1);
    expect(result).toEqual({
      releaseSha: request.companionReleaseSha,
      archiveSha256: request.companionArchiveSha256,
      installationTreeSha256: request.companionInstallationTreeSha256,
      observedAt: now.toISOString(),
    });
  });

  it('does not run a preflight for malformed claims or untrusted script paths', async () => {
    let calls = 0;
    const run = async () => {
      calls += 1;
      return VERIFIED_OUTPUT;
    };
    for (const [candidateRequest, candidateInputs] of [
      [{ ...request, companionArchiveSha256: 'not-a-digest' }, inputs],
      [request, { ...inputs, releaseTag: 'windows-companion-v0.1.10; unsafe' }],
      [request, { ...inputs, verifierScriptPath: inputs.archivePath }],
    ] as const) {
      await expect(
        verifyPublishedCompanionReleaseAndInstalledTreeWithRunner(
          candidateRequest,
          candidateInputs,
          run,
        ),
      ).rejects.toBeInstanceOf(CompanionActivationReleaseUnavailableError);
    }
    expect(calls).toBe(0);
  });

  it('rejects a false success, runner failure, or observation after request expiry', async () => {
    await expect(
      verifyPublishedCompanionReleaseAndInstalledTreeWithRunner(
        request,
        inputs,
        async () => 'almost verified',
      ),
    ).rejects.toBeInstanceOf(CompanionActivationReleaseUnavailableError);
    await expect(
      verifyPublishedCompanionReleaseAndInstalledTreeWithRunner(request, inputs, async () => {
        throw new Error('external-secret');
      }),
    ).rejects.toThrow('The companion release measurement is unavailable.');
    await expect(
      verifyPublishedCompanionReleaseAndInstalledTreeWithRunner(
        request,
        { ...inputs, trustedNow: () => new Date(now.getTime() + 600_000) },
        async () => VERIFIED_OUTPUT,
      ),
    ).rejects.toBeInstanceOf(CompanionActivationReleaseUnavailableError);
  });
});
