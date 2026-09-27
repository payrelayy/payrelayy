import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { win32 } from 'node:path';

import {
  guardedPrePermitChallengeDigest,
  type CompanionActivationReleaseAttestation,
  type CompanionActivationRequestSnapshot,
} from '@fetanagent/agent-platform-companion-execution-contracts';

import { bindGuardedPrePermitChild } from './guarded-pre-permit-child.js';
import type { GuardedProcessRehearsalChild } from './guarded-process-launch-rehearsal.js';

const PIPE_PREFIX = '\\\\.\\pipe\\fetanagent-companion-launch-';
const PIPE_SUFFIX = /^[0-9a-f]{32}$/u;
const RELEASE = /^[0-9a-f]{40}$/u;
const TREE_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAX_RELEASE_OBSERVATION_AGE_MS = 2 * 60_000;

export class GuardedCompanionProcessStarterUnavailableError extends Error {
  constructor() {
    super('The protected companion process starter is unavailable.');
    this.name = 'GuardedCompanionProcessStarterUnavailableError';
  }
}

export interface GuardedCompanionProcessStarterInputs {
  readonly request: CompanionActivationRequestSnapshot;
  /** Obtained from the independent published-archive and installed-tree preflight. */
  readonly release: CompanionActivationReleaseAttestation;
  readonly installationRoot: string;
  readonly dataRoot: string;
  /** Only the selected Windows runtime paths below are copied; no other ambient variable survives. */
  readonly windowsEnvironment: NodeJS.ProcessEnv;
  readonly trustedNow: () => Date;
}

type SpawnChild = (file: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

function timestamp(value: string): number {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) throw new Error();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error();
  return parsed;
}

function canonicalDirectory(path: string): string {
  if (
    typeof path !== 'string' ||
    !win32.isAbsolute(path) ||
    path.length > 220 ||
    /[\u0000-\u001f\u007f]/u.test(path) ||
    win32.normalize(path) !== path
  ) {
    throw new Error();
  }
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error();
  const actual = realpathSync.native(path);
  if (actual.toLowerCase() !== path.toLowerCase()) throw new Error();
  return path;
}

function ordinaryFile(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error();
  if (realpathSync.native(path).toLowerCase() !== path.toLowerCase()) throw new Error();
}

function runtimeEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of [
    'SystemRoot',
    'WINDIR',
    'LOCALAPPDATA',
    'APPDATA',
    'USERPROFILE',
    'TEMP',
    'TMP',
    'ProgramFiles',
    'ProgramFiles(x86)',
    'ProgramData',
  ]) {
    const value = source[key];
    if (value !== undefined) {
      if (typeof value !== 'string' || value.length === 0 || /[\u0000-\u001f\u007f]/u.test(value))
        throw new Error();
      result[key] = value;
    }
  }
  const windowsRoot = result.SystemRoot ?? result.WINDIR;
  if (!windowsRoot || !win32.isAbsolute(windowsRoot)) throw new Error();
  if (
    result.SystemRoot &&
    result.WINDIR &&
    result.SystemRoot.toLowerCase() !== result.WINDIR.toLowerCase()
  )
    throw new Error();
  if (!result.LOCALAPPDATA || !result.USERPROFILE) throw new Error();
  // Never inherit an operator's PATH or NODE_OPTIONS into an execution-capable child.
  result.PATH = `${windowsRoot}\\System32;${windowsRoot}`;
  return result;
}

function launchPaths(input: GuardedCompanionProcessStarterInputs): {
  readonly node: string;
  readonly entry: string;
  readonly dataRoot: string;
} {
  const installationRoot = canonicalDirectory(input.installationRoot);
  const dataRoot = canonicalDirectory(input.dataRoot);
  const runtimeRoot = canonicalDirectory(win32.join(installationRoot, 'runtime'));
  const appRoot = canonicalDirectory(win32.join(installationRoot, 'app'));
  const distRoot = canonicalDirectory(win32.join(appRoot, 'dist'));
  const node = win32.join(runtimeRoot, 'node.exe');
  const entry = win32.join(distRoot, 'index.js');
  const releaseMarker = win32.join(installationRoot, 'RELEASE_SHA');
  const treeMarker = win32.join(installationRoot, 'INSTALLATION_TREE_SHA256');
  for (const path of [node, entry, releaseMarker, treeMarker]) ordinaryFile(path);
  if (
    readFileSync(releaseMarker, 'utf8') !== input.release.releaseSha ||
    readFileSync(treeMarker, 'utf8') !== input.release.installationTreeSha256
  ) {
    throw new Error();
  }
  return { node, entry, dataRoot };
}

function validPipe(path: string): boolean {
  return (
    typeof path === 'string' &&
    path.startsWith(PIPE_PREFIX) &&
    PIPE_SUFFIX.test(path.slice(PIPE_PREFIX.length))
  );
}

/**
 * Constructs a one-use synchronous starter for the no-permit rehearsal. The
 * operator must first independently attest the published archive and complete
 * installed tree, then supply that fresh release result. This adapter still
 * rechecks the launch files and markers immediately before spawn. It neither
 * sends an execution permit nor invokes the database transition.
 *
 * The companion receives an IPC channel solely for its challenge-bound clean
 * pre-permit stop. No shell, detached child, command-line proof, inherited
 * credentials, or stdout/stderr capture is used. The caller owns the exact
 * returned child and must confirm its stop even when the rehearsal fails.
 */
export function prepareGuardedWindowsCompanionProcessStarterWithSpawn(
  input: GuardedCompanionProcessStarterInputs,
  spawnChild: SpawnChild,
): (request: Readonly<{ challenge: string; pipePath: string }>) => GuardedProcessRehearsalChild {
  try {
    // Keep launch inputs stable even if the caller mutates its own objects later.
    const launchInput: GuardedCompanionProcessStarterInputs = {
      ...input,
      request: { ...input.request },
      release: { ...input.release },
    };
    if (
      !RELEASE.test(launchInput.request.companionReleaseSha) ||
      !TREE_DIGEST.test(launchInput.request.companionArchiveSha256) ||
      !TREE_DIGEST.test(launchInput.request.companionInstallationTreeSha256) ||
      !ACCOUNT_ID.test(launchInput.request.platformAgentAccountId) ||
      launchInput.release.releaseSha !== launchInput.request.companionReleaseSha ||
      launchInput.release.archiveSha256 !== launchInput.request.companionArchiveSha256 ||
      launchInput.release.installationTreeSha256 !==
        launchInput.request.companionInstallationTreeSha256
    ) {
      throw new Error();
    }
    const now = launchInput.trustedNow();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error();
    const observed = timestamp(launchInput.release.observedAt);
    if (
      observed > now.getTime() ||
      now.getTime() - observed > MAX_RELEASE_OBSERVATION_AGE_MS ||
      now.getTime() < timestamp(launchInput.request.requestedAt) ||
      now.getTime() >= timestamp(launchInput.request.expiresAt)
    ) {
      throw new Error();
    }
    const ambient = runtimeEnvironment(launchInput.windowsEnvironment);
    launchPaths(launchInput);
    let started = false;
    return (request) => {
      try {
        if (started || !validPipe(request.pipePath)) throw new Error();
        guardedPrePermitChallengeDigest(request.challenge);
        const current = launchInput.trustedNow();
        if (
          !(current instanceof Date) ||
          !Number.isFinite(current.getTime()) ||
          current.getTime() < now.getTime() ||
          current.getTime() >= timestamp(launchInput.request.expiresAt) ||
          current.getTime() - observed > MAX_RELEASE_OBSERVATION_AGE_MS
        ) {
          throw new Error();
        }
        const { node, entry, dataRoot } = launchPaths(launchInput);
        started = true;
        const child = spawnChild(node, [entry], {
          cwd: win32.join(launchInput.installationRoot, 'app'),
          env: {
            ...ambient,
            FETANAGENT_COMPANION_DATA_ROOT: dataRoot,
            FETANAGENT_COMPANION_RELEASE_SHA: launchInput.release.releaseSha,
            INTERNAL_COMPANION_EXECUTION_V2_ENABLED: 'true',
            FETANAGENT_COMPANION_EXECUTION_PLATFORM_AGENT_ACCOUNT_ID:
              launchInput.request.platformAgentAccountId,
            FETANAGENT_COMPANION_LAUNCH_CHALLENGE: request.challenge,
            FETANAGENT_COMPANION_LAUNCH_PIPE: request.pipePath,
          },
          shell: false,
          detached: false,
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        });
        // Node reports a failed Windows spawn asynchronously. This listener
        // prevents an unhandled error even if pid is absent and we throw now.
        child.on('error', () => undefined);
        if (!Number.isInteger(child.pid) || child.pid === undefined || child.pid < 1) {
          throw new Error();
        }
        return bindGuardedPrePermitChild(child, request.challenge);
      } catch {
        throw new GuardedCompanionProcessStarterUnavailableError();
      }
    };
  } catch {
    throw new GuardedCompanionProcessStarterUnavailableError();
  }
}

/** Production wrapper; tests inject only a synthetic spawn adapter. */
export function prepareGuardedWindowsCompanionProcessStarter(
  input: GuardedCompanionProcessStarterInputs,
): (request: Readonly<{ challenge: string; pipePath: string }>) => GuardedProcessRehearsalChild {
  if (process.platform !== 'win32') throw new GuardedCompanionProcessStarterUnavailableError();
  return prepareGuardedWindowsCompanionProcessStarterWithSpawn(input, spawn);
}
