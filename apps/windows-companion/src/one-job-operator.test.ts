import { describe, expect, it, vi } from 'vitest';
import { ProtectedOperatorSshClientUnavailableError } from '@fetanagent/agent-platform-companion-activation-issuer/protected-operator-query-ssh-client';
import { GuardedOperatorActivationUnavailableError } from '@fetanagent/agent-platform-companion-activation-issuer/guarded-operator-ssh-activation';

import {
  OneJobOperatorUnavailableError,
  parseOneJobOperatorDocument,
  runOneJobOperatorWithAdapters,
} from './one-job-operator.js';

const requestKey = '22222222-2222-4222-8222-222222222222';
const actorAuthUserId = '33333333-3333-4333-8333-333333333333';
const raw = {
  version: 2,
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
  it('accepts only a bounded, identifier-free bootstrap document', () => {
    const document = parseOneJobOperatorDocument(JSON.stringify(raw));
    expect(document.version).toBe(2);
    expect('requestKey' in document).toBe(false);
    expect('actorAuthUserId' in document).toBe(false);
    expect(document.connection.remoteUser).toBe('fetanagent-operator');
    for (const candidate of [
      { ...raw, anotherOperation: true },
      { ...raw, version: 1 },
      { ...raw, requestKey: '33333333-3333-1333-8333-333333333333' },
      { ...raw, actorAuthUserId },
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

  it('obtains only one signed session binding after pairing', async () => {
    const document = parseOneJobOperatorDocument(JSON.stringify(raw));
    const device = { certificate: {}, createSignedHttpRequest: vi.fn() };
    const loadDevice = vi.fn(async () => device);
    const bootstrap = vi.fn(async () => ({ requestKey, actorAuthUserId }));
    const activate = vi.fn(
      async (_input: unknown, _device: unknown, _connection: unknown) => 'confirmed' as const,
    );
    const context = {
      dataRoot: 'C:\\FetanAgent\\data',
      installationRoot: 'C:\\FetanAgent\\installation',
      windowsEnvironment: {},
      trustedNow: () => new Date('2026-09-28T00:00:00.000Z'),
    };
    await expect(
      runOneJobOperatorWithAdapters(document, context, {
        loadDevice,
        bootstrap,
        activate,
      } as unknown as Parameters<typeof runOneJobOperatorWithAdapters>[2]),
    ).resolves.toBe('confirmed');
    expect(bootstrap).toHaveBeenCalledExactlyOnceWith(device, raw.connection);
    expect(activate.mock.calls[0]?.[0]).toMatchObject({ requestKey, actorAuthUserId });
    bootstrap.mockResolvedValueOnce({ requestKey: 'invalid', actorAuthUserId });
    await expect(
      runOneJobOperatorWithAdapters(document, context, {
        loadDevice,
        bootstrap,
        activate,
      } as unknown as Parameters<typeof runOneJobOperatorWithAdapters>[2]),
    ).rejects.toBeInstanceOf(OneJobOperatorUnavailableError);
    expect(activate).toHaveBeenCalledTimes(1);
    bootstrap.mockRejectedValueOnce(new Error('private bootstrap failure'));
    await expect(
      runOneJobOperatorWithAdapters(document, context, {
        loadDevice,
        bootstrap,
        activate,
      } as unknown as Parameters<typeof runOneJobOperatorWithAdapters>[2]),
    ).rejects.toBeInstanceOf(OneJobOperatorUnavailableError);
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('loads the existing paired certificate then runs one guarded SSH activation', async () => {
    const device = { certificate: {}, createSignedHttpRequest: vi.fn() };
    const loadDevice = vi.fn(async () => device);
    const activate = vi.fn(
      async (_input: unknown, _device: unknown, _connection: unknown) => 'confirmed' as const,
    );
    const bootstrap = vi.fn(async () => ({ requestKey, actorAuthUserId }));
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
        bootstrap,
        activate,
      } as unknown as Parameters<typeof runOneJobOperatorWithAdapters>[2]),
    ).resolves.toBe('confirmed');
    expect(loadDevice).toHaveBeenCalledExactlyOnceWith({ dataRoot: context.dataRoot });
    expect(bootstrap).toHaveBeenCalledExactlyOnceWith(device, raw.connection);
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

  it('rejects a legacy direct-binding document before loading the device', async () => {
    const loadDevice = vi.fn();
    const bootstrap = vi.fn();
    const activate = vi.fn();
    await expect(
      runOneJobOperatorWithAdapters(
        { ...raw, version: 1, requestKey, actorAuthUserId } as unknown as ReturnType<
          typeof parseOneJobOperatorDocument
        >,
        {
          dataRoot: 'C:\\FetanAgent\\data',
          installationRoot: 'C:\\FetanAgent\\installation',
          windowsEnvironment: {},
          trustedNow: () => new Date(),
        },
        { loadDevice, bootstrap, activate } as unknown as Parameters<
          typeof runOneJobOperatorWithAdapters
        >[2],
      ),
    ).rejects.toBeInstanceOf(OneJobOperatorUnavailableError);
    expect(loadDevice).not.toHaveBeenCalled();
    expect(bootstrap).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it('reports only fixed startup stages and never the underlying failure', async () => {
    const document = parseOneJobOperatorDocument(JSON.stringify(raw));
    const context = {
      dataRoot: 'C:\\FetanAgent\\data',
      installationRoot: 'C:\\FetanAgent\\installation',
      windowsEnvironment: {},
      trustedNow: () => new Date(),
    };
    const device = { certificate: {}, createSignedHttpRequest: vi.fn() };
    const failures = [
      {
        expected: 'device_enrollment',
        loadDevice: vi.fn(async () => {
          throw new Error('private device detail');
        }),
        bootstrap: vi.fn(),
        activate: vi.fn(),
      },
      {
        expected: 'bootstrap_ssh_transport',
        loadDevice: vi.fn(async () => device),
        bootstrap: vi.fn(async () => {
          throw new ProtectedOperatorSshClientUnavailableError('ssh_transport');
        }),
        activate: vi.fn(),
      },
      {
        expected: 'bootstrap_http_response',
        loadDevice: vi.fn(async () => device),
        bootstrap: vi.fn(async () => {
          throw new ProtectedOperatorSshClientUnavailableError('http_response');
        }),
        activate: vi.fn(),
      },
      {
        expected: 'bootstrap_binding',
        loadDevice: vi.fn(async () => device),
        bootstrap: vi.fn(async () => ({ requestKey: 'invalid', actorAuthUserId })),
        activate: vi.fn(),
      },
      {
        expected: 'guarded_activation',
        loadDevice: vi.fn(async () => device),
        bootstrap: vi.fn(async () => ({ requestKey, actorAuthUserId })),
        activate: vi.fn(async () => {
          throw new Error('private activation detail');
        }),
      },
      {
        expected: 'guarded_activation',
        activationStage: 'handoff_http_response',
        loadDevice: vi.fn(async () => device),
        bootstrap: vi.fn(async () => ({ requestKey, actorAuthUserId })),
        activate: vi.fn(async () => {
          throw new GuardedOperatorActivationUnavailableError('handoff_http_response');
        }),
      },
    ];
    for (const failure of failures) {
      const error = await runOneJobOperatorWithAdapters(
        document,
        context,
        failure as unknown as Parameters<typeof runOneJobOperatorWithAdapters>[2],
      ).catch((value: unknown) => value);
      expect(error).toBeInstanceOf(OneJobOperatorUnavailableError);
      expect((error as OneJobOperatorUnavailableError).stage).toBe(failure.expected);
      expect((error as OneJobOperatorUnavailableError).activationStage).toBe(
        'activationStage' in failure ? failure.activationStage : undefined,
      );
      expect(JSON.stringify(error)).not.toContain('private');
      if (failure.expected !== 'guarded_activation')
        expect(failure.activate).not.toHaveBeenCalled();
    }
    expect(() => parseOneJobOperatorDocument('{private')).toThrowError(
      new OneJobOperatorUnavailableError('document'),
    );
  });
});
