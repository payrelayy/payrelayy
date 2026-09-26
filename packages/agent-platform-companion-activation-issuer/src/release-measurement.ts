import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import { promisify } from 'node:util';

import type {
  CompanionActivationReleaseAttestation,
  CompanionActivationRequestSnapshot,
} from '@fetanagent/agent-platform-companion-execution-contracts';

const execFileAsync = promisify(execFile);
const RELEASE = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const RELEASE_TAG = /^windows-companion-v[A-Za-z0-9._-]+$/u;
const PREFLIGHT_FILENAME = 'verify-windows-companion-release-installation.ps1';
const PREFLIGHT_SOURCE_SHA256 = '55f33f45e584b74a9cab56d67cbf93132ab3f3d178e9fac0514bf99140c458f6';
const VERIFIED_OUTPUT = 'COMPANION_RELEASE_INSTALLATION_VERIFIED; no activation was performed.';

export interface CompanionActivationReleaseInputs {
  /** Exact published tag; the pinned preflight resolves and compares its commit. */
  readonly releaseTag: string;
  /** Immutable published archive and its checksum, obtained by the operator workflow. */
  readonly archivePath: string;
  readonly checksumPath: string;
  /** Exact installed release tree on the paired Windows host. */
  readonly installationRoot: string;
  /** Reviewed source checkout, not a path supplied by the companion. */
  readonly verifierScriptPath: string;
  /** Trusted local PowerShell 7 executable, not a PATH lookup. */
  readonly powershellExecutable: string;
  /** Operator-side trusted clock, not the companion clock. */
  readonly trustedNow: () => Date;
}

export class CompanionActivationReleaseUnavailableError extends Error {
  constructor() {
    super('The companion release measurement is unavailable.');
    this.name = 'CompanionActivationReleaseUnavailableError';
  }
}

type PreflightRunner = (executable: string, arguments_: readonly string[]) => Promise<string>;

async function runReviewedPreflight(
  executable: string,
  arguments_: readonly string[],
): Promise<string> {
  const { stdout } = await execFileAsync(executable, [...arguments_], {
    encoding: 'utf8',
    maxBuffer: 4096,
    timeout: 5 * 60_000,
    windowsHide: true,
  });
  return stdout;
}

function absolutePath(value: string): boolean {
  return (
    typeof value === 'string' && value.length > 0 && !value.includes('\0') && isAbsolute(value)
  );
}

function timestamp(value: string): number {
  if (typeof value !== 'string') throw new Error();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error();
  return parsed;
}

/**
 * Test seam for the pinned PowerShell preflight. Only the public wrapper below
 * is exported by the package; production cannot inject a success result.
 */
export async function verifyPublishedCompanionReleaseAndInstalledTreeWithRunner(
  request: CompanionActivationRequestSnapshot,
  inputs: CompanionActivationReleaseInputs,
  run: PreflightRunner,
): Promise<CompanionActivationReleaseAttestation> {
  try {
    if (
      !RELEASE.test(request.companionReleaseSha) ||
      !DIGEST.test(request.companionArchiveSha256) ||
      !DIGEST.test(request.companionInstallationTreeSha256) ||
      !RELEASE_TAG.test(inputs.releaseTag) ||
      !absolutePath(inputs.archivePath) ||
      !absolutePath(inputs.checksumPath) ||
      !absolutePath(inputs.installationRoot) ||
      !absolutePath(inputs.verifierScriptPath) ||
      !absolutePath(inputs.powershellExecutable) ||
      basename(inputs.verifierScriptPath) !== PREFLIGHT_FILENAME ||
      basename(inputs.powershellExecutable).toLowerCase() !== 'pwsh.exe'
    ) {
      throw new Error();
    }
    const scriptStat = await lstat(inputs.verifierScriptPath);
    if (!scriptStat.isFile() || scriptStat.isSymbolicLink()) throw new Error();
    const source = (await readFile(inputs.verifierScriptPath, 'utf8')).replace(/\r\n/gu, '\n');
    if (createHash('sha256').update(source).digest('hex') !== PREFLIGHT_SOURCE_SHA256) {
      throw new Error();
    }
    const output = await run(inputs.powershellExecutable, [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      inputs.verifierScriptPath,
      '-ReleaseTag',
      inputs.releaseTag,
      '-ReleaseSha',
      request.companionReleaseSha,
      '-ArchivePath',
      inputs.archivePath,
      '-ChecksumPath',
      inputs.checksumPath,
      '-InstallationRoot',
      inputs.installationRoot,
      '-ExpectedArchiveSha256',
      request.companionArchiveSha256,
      '-ExpectedInstallationTreeSha256',
      request.companionInstallationTreeSha256,
    ]);
    if (output.trim() !== VERIFIED_OUTPUT) throw new Error();
    const observed = inputs.trustedNow();
    if (!(observed instanceof Date) || !Number.isFinite(observed.getTime())) throw new Error();
    const observedAt = observed.toISOString();
    if (
      observed.getTime() < timestamp(request.requestedAt) ||
      observed.getTime() >= timestamp(request.expiresAt)
    ) {
      throw new Error();
    }
    return {
      releaseSha: request.companionReleaseSha,
      archiveSha256: request.companionArchiveSha256,
      installationTreeSha256: request.companionInstallationTreeSha256,
      observedAt,
    };
  } catch {
    throw new CompanionActivationReleaseUnavailableError();
  }
}

/**
 * Run the existing source-pinned, read-only release/installation preflight.
 * This is an operator-side adapter, not a companion or application endpoint.
 */
export async function verifyPublishedCompanionReleaseAndInstalledTree(
  request: CompanionActivationRequestSnapshot,
  inputs: CompanionActivationReleaseInputs,
): Promise<CompanionActivationReleaseAttestation> {
  if (process.platform !== 'win32') throw new CompanionActivationReleaseUnavailableError();
  return verifyPublishedCompanionReleaseAndInstalledTreeWithRunner(
    request,
    inputs,
    runReviewedPreflight,
  );
}
