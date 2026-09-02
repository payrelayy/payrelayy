import { open, readFile, rm, type FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface SessionLock {
  readonly handle: FileHandle;
  readonly path: string;
}

function occupied(): Error {
  return Object.assign(
    new Error('The companion profile is already in use or needs lock recovery.'),
    {
      code: 'FETANAGENT_PROFILE_IN_USE',
    },
  );
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

/** All acquisition/recovery is serialized. A crashed recovery lock requires manual review. */
export async function acquireSessionLock(dataRoot: string): Promise<SessionLock> {
  const lockPath = resolve(dataRoot, 'companion.lock');
  const recoveryPath = resolve(dataRoot, 'companion-recovery.lock');
  let recovery: FileHandle;
  try {
    recovery = await open(recoveryPath, 'wx', 0o600);
  } catch (error) {
    if (hasCode(error, 'EEXIST')) throw occupied();
    throw error;
  }

  const create = async (): Promise<SessionLock> => {
    const handle = await open(lockPath, 'wx', 0o600);
    try {
      await handle.writeFile(`${process.pid}\n`, { encoding: 'utf8' });
      return Object.freeze({ handle, path: lockPath });
    } catch (error) {
      await handle.close();
      // An incomplete lock remains fail-closed for explicit recovery.
      throw error;
    }
  };

  try {
    try {
      return await create();
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error;
    }
    // Read and check only while holding the exclusive recovery lock. Another starter cannot
    // replace the stale lock between this proof and removal.
    let rawPid: string;
    try {
      rawPid = (await readFile(lockPath, 'utf8')).trim();
    } catch {
      throw occupied();
    }
    if (!/^[1-9][0-9]{0,9}$/u.test(rawPid)) throw occupied();
    let provenDead = false;
    try {
      process.kill(Number(rawPid), 0);
    } catch (error) {
      provenDead = hasCode(error, 'ESRCH');
    }
    if (!provenDead) throw occupied();
    await rm(lockPath);
    return await create();
  } finally {
    await recovery.close();
    await rm(recoveryPath);
  }
}

export async function releaseSessionLock(lock: SessionLock | undefined): Promise<void> {
  if (!lock) return;
  try {
    await lock.handle.close();
  } finally {
    await rm(lock.path, { force: true });
  }
}
