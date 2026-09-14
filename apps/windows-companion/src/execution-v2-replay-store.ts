import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

import type {
  CryptographicallyVerifiedOneUseActionAuthority,
  ExternalAtomicReplayConsumptionReceipt,
} from '@fetanagent/agent-platform-companion-execution-contracts';

const EXECUTION_DIRECTORY = 'execution-v2';
const CONSUMED_AUTHORITIES_DIRECTORY = 'consumed-authorities';
const SHA256_PATTERN = /^sha256:([0-9a-f]{64})$/u;
const MAXIMUM_MARKER_BYTES = 1_024;

interface ConsumedAuthorityMarker extends ExternalAtomicReplayConsumptionReceipt {
  readonly markerVersion: 2;
  readonly consumedAt: string;
}

export interface ConsumeWindowsCompanionExecutionV2AuthorityOptions {
  readonly dataRoot: string;
  readonly now?: () => Date;
}

export class WindowsCompanionExecutionV2ReplayStoreUnavailableError extends Error {
  constructor() {
    super('Windows companion execution-v2 replay protection is unavailable.');
    this.name = 'WindowsCompanionExecutionV2ReplayStoreUnavailableError';
  }
}

function unavailable(): never {
  throw new WindowsCompanionExecutionV2ReplayStoreUnavailableError();
}

function normalizePath(value: string): string {
  return process.platform === 'win32' ? value.toLocaleLowerCase('en-US') : value;
}

function validVerification(
  candidate: CryptographicallyVerifiedOneUseActionAuthority,
): RegExpExecArray | null {
  if (
    candidate.verificationKind !== 'cryptographically_verified_one_use_action_authority' ||
    candidate.grantsActionAuthority !== false ||
    candidate.atomicReplayConsumptionRequired !== true ||
    !SHA256_PATTERN.test(candidate.authorityBodyDigest)
  ) {
    return null;
  }
  return SHA256_PATTERN.exec(candidate.replayIdentity);
}

async function stableConsumedAuthorityRoot(dataRoot: string): Promise<string> {
  const deviceRoot = resolve(dataRoot, 'device');
  const executionRoot = resolve(deviceRoot, EXECUTION_DIRECTORY);
  const consumedRoot = resolve(executionRoot, CONSUMED_AUTHORITIES_DIRECTORY);
  await mkdir(consumedRoot, { recursive: true, mode: 0o700 });
  const [
    deviceStat,
    executionStat,
    consumedStat,
    canonicalDataRoot,
    canonicalDeviceRoot,
    canonicalExecutionRoot,
    canonicalConsumedRoot,
  ] = await Promise.all([
    lstat(deviceRoot),
    lstat(executionRoot),
    lstat(consumedRoot),
    realpath(dataRoot),
    realpath(deviceRoot),
    realpath(executionRoot),
    realpath(consumedRoot),
  ]);
  if (
    !deviceStat.isDirectory() ||
    deviceStat.isSymbolicLink() ||
    !executionStat.isDirectory() ||
    executionStat.isSymbolicLink() ||
    !consumedStat.isDirectory() ||
    consumedStat.isSymbolicLink() ||
    normalizePath(canonicalDeviceRoot) !== normalizePath(resolve(canonicalDataRoot, 'device')) ||
    normalizePath(canonicalExecutionRoot) !==
      normalizePath(resolve(canonicalDeviceRoot, EXECUTION_DIRECTORY)) ||
    normalizePath(canonicalConsumedRoot) !==
      normalizePath(resolve(canonicalExecutionRoot, CONSUMED_AUTHORITIES_DIRECTORY))
  ) {
    unavailable();
  }
  return canonicalConsumedRoot;
}

async function syncDirectoryBestEffort(path: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, 'r');
    await handle.sync();
  } catch {
    // Windows may not expose flushable directory handles. The marker itself is still fsynced.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Atomically consumes a cryptographically verified authority once on this Windows account.
 * Existing markers are never treated as successful receipts: only this call's exclusive create
 * can return the receipt accepted by the immediate deadline recheck.
 */
export async function consumeWindowsCompanionExecutionV2AuthorityOnce(
  verification: CryptographicallyVerifiedOneUseActionAuthority,
  options: ConsumeWindowsCompanionExecutionV2AuthorityOptions,
): Promise<ExternalAtomicReplayConsumptionReceipt> {
  const match = validVerification(verification);
  const consumedAt = (options.now ?? (() => new Date()))().toISOString();
  if (!match || !Number.isFinite(Date.parse(consumedAt))) unavailable();
  const root = await stableConsumedAuthorityRoot(options.dataRoot);
  const markerPath = resolve(root, `${match[1]}.consumed.json`);
  const receipt: ExternalAtomicReplayConsumptionReceipt = Object.freeze({
    receiptKind: 'external_atomic_replay_consumption',
    replayIdentity: verification.replayIdentity,
    authorityBodyDigest: verification.authorityBodyDigest,
    consumedExactlyOnce: true,
  });
  const marker: ConsumedAuthorityMarker = Object.freeze({
    markerVersion: 2,
    consumedAt,
    ...receipt,
  });
  const contents = `${JSON.stringify(marker)}\n`;
  if (Buffer.byteLength(contents, 'utf8') > MAXIMUM_MARKER_BYTES) unavailable();

  let handle;
  try {
    handle = await open(markerPath, 'wx', 0o600);
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    const stat = await lstat(markerPath);
    const canonicalMarker = await realpath(markerPath);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size !== Buffer.byteLength(contents, 'utf8') ||
      normalizePath(canonicalMarker) !== normalizePath(markerPath)
    ) {
      unavailable();
    }
    await syncDirectoryBestEffort(root);
    return receipt;
  } catch (error) {
    if (error instanceof WindowsCompanionExecutionV2ReplayStoreUnavailableError) throw error;
    return unavailable();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
