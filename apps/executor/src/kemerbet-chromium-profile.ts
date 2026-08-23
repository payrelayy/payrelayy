import { lstat, unlink } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const CHROMIUM_SINGLETON_ARTIFACTS = Object.freeze([
  'SingletonCookie',
  'SingletonLock',
  'SingletonSocket',
] as const);

export interface KemerBetSingletonArtifactFileSystem {
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
  unlink(path: string): Promise<void>;
}

export class KemerBetChromiumProfileUnavailableError extends Error {
  constructor() {
    super('The private KemerBet Chromium profile boundary is unavailable.');
    this.name = 'KemerBetChromiumProfileUnavailableError';
  }
}

function unavailable(): never {
  throw new KemerBetChromiumProfileUnavailableError();
}

function hasErrorCode(error: unknown, expectedCode: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === expectedCode
  );
}

/**
 * A force-stopped Chromium process can leave these three profile-owner symlinks behind. A newly
 * started, isolated session container has no inherited Chromium process, so removing only these
 * exact symlinks once per profile restores the persistent profile without touching KemerBet data.
 */
export async function removeStaleChromiumSingletonArtifacts(
  profilePath: string,
  fileSystem: KemerBetSingletonArtifactFileSystem = { lstat, unlink },
): Promise<void> {
  for (const artifact of CHROMIUM_SINGLETON_ARTIFACTS) {
    const artifactPath = resolve(profilePath, artifact);
    if (relative(profilePath, artifactPath) !== artifact) unavailable();
    try {
      const stat = await fileSystem.lstat(artifactPath);
      if (!stat.isSymbolicLink()) unavailable();
      await fileSystem.unlink(artifactPath);
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) unavailable();
    }
  }
}
