import { describe, expect, it, vi } from 'vitest';

import {
  OneJobOperatorUnavailableError,
  parseOneJobOperatorDocument,
  runOneJobOperatorWithAdapters,
} from './one-job-operator.js';

const requestKey = '22222222-2222-4222-8222-222222222222';
const actorAuthUserId = '33333333-3333-4333-8333-333333333333';
const raw = {
  version: 1,
  requestKey,
  actorAuthUserId,
  releaseTag: 'windows-companion-v0.1.12',
  archivePath: 'C:\\FetanAgent\\release.zip',
  checksumPath: 'C:\\FetanAgent\\release.zip.sha256',
  verifierScriptPath: 'C:\\FetanAgent\\source\\verify.ps1',
  powershellExecutable: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
  processVerifierScriptPath: 'C:\\FetanAgent\\source\\inspect.ps1',
  connection: {
    identityFile: 'C:\\FetanAgent\\operator-key',
    knownHostsFile: 'C:\\FetanAgent\\known-hosts',
    remoteHostIpv4: '192.0.2.12',
    remoteUser: 'fetanagent-operator',
    remoteSshPort: 22,
    remoteLoopbackPort: 743,
  },
} as const;

describe('one-job Windows operator entry point', () => {
  it('accepts only a bounded exact one-use run document', () => {
    const document = parseOneJobOperatorDocument(JSON.stringify(raw));
    expect(document.requestKey).toBe(requestKey);
    expect(document.connection.remoteUser).toBe('fetanagent-operator');
    for (const candidate of [
      { ...raw, anotherOperation: true },
      { ...raw, requestKey: '33333333-3333-1333-8333-333333333333' },
      { ...raw, archivePath: '..\\release.zip' },
      { ...raw, archivePath: '\\\\other-computer\\share\\release.zip' },
      { ...raw, connection: { ...raw.connection, remoteLoopbackPort: 744 } },
      { ...raw, connection: { ...raw.connection, remoteUser: 'root' } },
    ]) {
      expect(() => parseOneJobOperatorDocument(JSON.stringify(candidate))).toThrow(
        OneJobOperatorUnavailableError,
      );
    }
    expect(() => parseOneJobOperatorDocument('x'.repeat(8_193))).toThrow(
      OneJobOperatorUnavailableError,
    );
  });

  it('loads the existing paired certificate then runs one guarded SSH activation', async () => {
    const device = { certificate: {}, createSignedHttpRequest: vi.fn() };
    const loadDevice = vi.fn(async () => device);
    const activate = vi.fn(
      async (_input: unknown, _device: unknown, _connection: unknown) => 'confirmed' as const,
    );
    const context = {
      dataRoot: 'C:\\FetanAgent\\data',
      installationRoot: 'C:\\FetanAgent\\installation',
      windowsEnvironment: {},
      trustedNow: () => new Date('2026-09-28T00:00:00.000Z'),
    };
    const document = parseOneJobOperatorDocument(JSON.stringify(raw));
    await expect(
      runOneJobOperatorWithAdapters(document, context, {
        loadDevice,
        activate,
      } as unknown as Parameters<typeof runOneJobOperatorWithAdapters>[2]),
    ).resolves.toBe('confirmed');
    expect(loadDevice).toHaveBeenCalledExactlyOnceWith({ dataRoot: context.dataRoot });
    expect(activate).toHaveBeenCalledTimes(1);
    expect(activate.mock.calls[0]?.[0]).toMatchObject({
      requestKey,
      actorAuthUserId,
      releaseInputs: { installationRoot: context.installationRoot },
      dataRoot: context.dataRoot,
    });
    expect(activate.mock.calls[0]?.[1]).toBe(device);
    expect(activate.mock.calls[0]?.[2]).toEqual(raw.connection);
  });

  it('does not open the remote operator session after a local abort or pairing failure', async () => {
    const document = parseOneJobOperatorDocument(JSON.stringify(raw));
    const activate = vi.fn();
    const loadDevice = vi.fn(async () => {
      throw new Error('sensitive local failure');
    });
    const context = {
      dataRoot: 'C:\\FetanAgent\\data',
      installationRoot: 'C:\\FetanAgent\\installation',
      windowsEnvironment: {},
      trustedNow: () => new Date(),
      signal: AbortSignal.abort(),
    };
    await expect(
      runOneJobOperatorWithAdapters(document, context, {
        loadDevice,
        activate,
      } as unknown as Parameters<typeof runOneJobOperatorWithAdapters>[2]),
    ).rejects.toThrow(OneJobOperatorUnavailableError);
    expect(loadDevice).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    await expect(
      runOneJobOperatorWithAdapters(
        document,
        {
          dataRoot: context.dataRoot,
          installationRoot: context.installationRoot,
          windowsEnvironment: context.windowsEnvironment,
          trustedNow: context.trustedNow,
        },
        {
          loadDevice,
          activate,
        } as unknown as Parameters<typeof runOneJobOperatorWithAdapters>[2],
      ),
    ).rejects.toThrow(OneJobOperatorUnavailableError);
    expect(loadDevice).toHaveBeenCalledTimes(1);
    expect(activate).not.toHaveBeenCalled();
  });
});
