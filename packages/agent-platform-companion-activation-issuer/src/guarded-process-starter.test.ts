import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { win32 } from 'node:path';

import {
  guardedPrePermitStopped,
  isGuardedPrePermitStopRequest,
} from '@fetanagent/agent-platform-companion-execution-contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GuardedCompanionProcessStarterUnavailableError,
  prepareGuardedWindowsCompanionProcessStarterWithSpawn,
  type GuardedCompanionProcessStarterInputs,
} from './guarded-process-starter.js';

const created: string[] = [];
afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixture() {
  const installationRoot = mkdtempSync(win32.join(tmpdir(), 'guarded-companion-starter-'));
  const dataRoot = mkdtempSync(win32.join(tmpdir(), 'guarded-companion-data-'));
  created.push(installationRoot, dataRoot);
  mkdirSync(win32.join(installationRoot, 'runtime'));
  mkdirSync(win32.join(installationRoot, 'app', 'dist'), { recursive: true });
  const releaseSha = 'a'.repeat(40);
  const installationTreeSha256 = `sha256:${'b'.repeat(64)}`;
  const archiveSha256 = `sha256:${'c'.repeat(64)}`;
  writeFileSync(win32.join(installationRoot, 'runtime', 'node.exe'), 'synthetic');
  writeFileSync(win32.join(installationRoot, 'app', 'dist', 'index.js'), 'synthetic');
  writeFileSync(win32.join(installationRoot, 'RELEASE_SHA'), releaseSha);
  writeFileSync(win32.join(installationRoot, 'INSTALLATION_TREE_SHA256'), installationTreeSha256);
  const input: GuardedCompanionProcessStarterInputs = {
    request: {
      requestKey: randomUUID(),
      pilotRevisionId: randomUUID(),
      activationEpoch: '1',
      certificateId: randomUUID(),
      platformAgentAccountId: randomUUID(),
      companionReleaseSha: releaseSha,
      companionArchiveSha256: archiveSha256,
      companionInstallationTreeSha256: installationTreeSha256,
      requestedAt: '2026-09-27T00:00:00.000Z',
      expiresAt: '2026-09-27T00:10:00.000Z',
    },
    release: {
      releaseSha,
      archiveSha256,
      installationTreeSha256,
      observedAt: '2026-09-27T00:00:01.000Z',
    },
    installationRoot,
    dataRoot,
    windowsEnvironment: {
      SystemRoot: 'C:\\Windows',
      LOCALAPPDATA: 'C:\\Users\\operator\\AppData\\Local',
      USERPROFILE: 'C:\\Users\\operator',
      PATH: 'C:\\untrusted\\bin',
      NODE_OPTIONS: '--require=unsafe',
      FETANAGENT_COMPANION_PAIRING_PACKAGE: 'must-not-inherit',
      COMPANION_EXECUTION_DATABASE_URL: 'must-not-inherit',
    },
    trustedNow: () => new Date('2026-09-27T00:00:02.000Z'),
  };
  const challenge = randomBytes(32).toString('base64url');
  const pipePath = '\\\\.\\pipe\\fetanagent-companion-launch-00000000000000000000000000000000';
  const child = Object.assign(new EventEmitter(), {
    pid: 4321 as number | undefined,
    connected: true,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    send: vi.fn((_message: unknown, callback: (error: Error | null) => void) => {
      callback(null);
      return true;
    }),
  });
  const spawn = vi.fn((_node: string, _args: readonly string[], _options: SpawnOptions) => {
    return child as unknown as ChildProcess;
  });
  return { input, installationRoot, dataRoot, challenge, pipePath, child, spawn };
}

describe('protected one-use Windows companion starter', () => {
  it('spawns only the attested release files with private IPC and an allowlisted environment', async () => {
    const f = fixture();
    const start = prepareGuardedWindowsCompanionProcessStarterWithSpawn(f.input, f.spawn);
    const owned = start({ challenge: f.challenge, pipePath: f.pipePath });
    expect(owned.processId).toBe(4321);
    expect(f.spawn).toHaveBeenCalledOnce();
    const [node, args, options] = f.spawn.mock.calls[0]!;
    expect(node).toBe(win32.join(f.installationRoot, 'runtime', 'node.exe'));
    expect(args).toEqual([win32.join(f.installationRoot, 'app', 'dist', 'index.js')]);
    expect(options).toMatchObject({
      cwd: win32.join(f.installationRoot, 'app'),
      shell: false,
      detached: false,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    expect(options.env).toEqual({
      SystemRoot: 'C:\\Windows',
      LOCALAPPDATA: 'C:\\Users\\operator\\AppData\\Local',
      USERPROFILE: 'C:\\Users\\operator',
      PATH: 'C:\\Windows\\System32;C:\\Windows',
      FETANAGENT_COMPANION_DATA_ROOT: f.dataRoot,
      FETANAGENT_COMPANION_RELEASE_SHA: f.input.release.releaseSha,
      INTERNAL_COMPANION_EXECUTION_V2_ENABLED: 'true',
      FETANAGENT_COMPANION_EXECUTION_PLATFORM_AGENT_ACCOUNT_ID:
        f.input.request.platformAgentAccountId,
      FETANAGENT_COMPANION_LAUNCH_CHALLENGE: f.challenge,
      FETANAGENT_COMPANION_LAUNCH_PIPE: f.pipePath,
    });
    const pending = owned.stop();
    expect(isGuardedPrePermitStopRequest(f.child.send.mock.calls[0]?.[0], f.challenge)).toBe(true);
    f.child.emit('message', guardedPrePermitStopped(f.challenge));
    f.child.exitCode = 0;
    f.child.connected = false;
    f.child.emit('close', 0, null);
    await expect(pending).resolves.toBeUndefined();
    await expect(owned.stopped).resolves.toBeUndefined();
    expect(() => start({ challenge: f.challenge, pipePath: f.pipePath })).toThrow(
      GuardedCompanionProcessStarterUnavailableError,
    );
    expect(f.spawn).toHaveBeenCalledOnce();
  });

  it('rejects a stale or mismatched release before any launch', () => {
    const f = fixture();
    expect(() =>
      prepareGuardedWindowsCompanionProcessStarterWithSpawn(
        { ...f.input, release: { ...f.input.release, releaseSha: 'd'.repeat(40) } },
        f.spawn,
      ),
    ).toThrow(GuardedCompanionProcessStarterUnavailableError);
    expect(() =>
      prepareGuardedWindowsCompanionProcessStarterWithSpawn(
        { ...f.input, release: { ...f.input.release, observedAt: '2026-09-26T23:57:00.000Z' } },
        f.spawn,
      ),
    ).toThrow(GuardedCompanionProcessStarterUnavailableError);
    expect(f.spawn).not.toHaveBeenCalled();
  });

  it('rejects a changed installed marker and invalid channel before spawn', () => {
    const f = fixture();
    const start = prepareGuardedWindowsCompanionProcessStarterWithSpawn(f.input, f.spawn);
    expect(() =>
      start({ challenge: f.challenge, pipePath: 'https://example.invalid/proof' }),
    ).toThrow(GuardedCompanionProcessStarterUnavailableError);
    writeFileSync(win32.join(f.installationRoot, 'INSTALLATION_TREE_SHA256'), 'changed');
    expect(readFileSync(win32.join(f.installationRoot, 'INSTALLATION_TREE_SHA256'), 'utf8')).toBe(
      'changed',
    );
    expect(() => start({ challenge: f.challenge, pipePath: f.pipePath })).toThrow(
      GuardedCompanionProcessStarterUnavailableError,
    );
    expect(f.spawn).not.toHaveBeenCalled();
  });

  it('uses the preflight account snapshot rather than later caller mutations', () => {
    const f = fixture();
    const account = f.input.request.platformAgentAccountId;
    const start = prepareGuardedWindowsCompanionProcessStarterWithSpawn(f.input, f.spawn);
    (f.input.request as { platformAgentAccountId: string }).platformAgentAccountId = randomUUID();
    start({ challenge: f.challenge, pipePath: f.pipePath });
    expect(
      f.spawn.mock.calls[0]?.[2].env?.FETANAGENT_COMPANION_EXECUTION_PLATFORM_AGENT_ACCOUNT_ID,
    ).toBe(account);
  });

  it('fails closed if the OS spawn reports no child PID', () => {
    const f = fixture();
    f.child.pid = undefined;
    const start = prepareGuardedWindowsCompanionProcessStarterWithSpawn(f.input, f.spawn);
    expect(() => start({ challenge: f.challenge, pipePath: f.pipePath })).toThrow(
      GuardedCompanionProcessStarterUnavailableError,
    );
    expect(f.spawn).toHaveBeenCalledOnce();
    expect(() => f.child.emit('error', new Error('redacted OS spawn error'))).not.toThrow();
    expect(() => start({ challenge: f.challenge, pipePath: f.pipePath })).toThrow(
      GuardedCompanionProcessStarterUnavailableError,
    );
    expect(f.spawn).toHaveBeenCalledOnce();
  });
});
