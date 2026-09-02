import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { acquireSessionLock, releaseSessionLock } from './session-lock.js';

const roots: string[] = [];
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'fetanagent-lock-test-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('companion session lock', () => {
  it('allows one owner and permits a new owner only after release', async () => {
    const root = await fixture();
    const first = await acquireSessionLock(root);
    try {
      await expect(acquireSessionLock(root)).rejects.toMatchObject({
        code: 'FETANAGENT_PROFILE_IN_USE',
      });
    } finally {
      await releaseSessionLock(first);
    }
    await releaseSessionLock(await acquireSessionLock(root));
  });

  it('serializes simultaneous recovery of one stale lock without deleting the winning lock', async () => {
    const root = await fixture();
    await writeFile(join(root, 'companion.lock'), '2147483646\n');
    const kill = vi.spyOn(process, 'kill').mockImplementation((pid) => {
      if (pid === 2147483646) throw Object.assign(new Error('No process'), { code: 'ESRCH' });
      return true;
    });
    const results = await Promise.allSettled([acquireSessionLock(root), acquireSessionLock(root)]);
    const winners = results.filter((result) => result.status === 'fulfilled');
    expect(winners).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const winner = winners[0]!;
    try {
      expect(await readFile(join(root, 'companion.lock'), 'utf8')).toBe(`${process.pid}\n`);
      expect(kill.mock.calls.filter(([pid]) => pid === 2147483646)).toHaveLength(1);
      await expect(acquireSessionLock(root)).rejects.toMatchObject({
        code: 'FETANAGENT_PROFILE_IN_USE',
      });
    } finally {
      await releaseSessionLock(winner.value);
    }
  });

  it.each(['EPERM', 'EINVAL'])('never recovers a lock on %s', async (code) => {
    const root = await fixture();
    await writeFile(join(root, 'companion.lock'), '12345\n');
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('Denied'), { code });
    });
    await expect(acquireSessionLock(root)).rejects.toMatchObject({
      code: 'FETANAGENT_PROFILE_IN_USE',
    });
    expect(await readFile(join(root, 'companion.lock'), 'utf8')).toBe('12345\n');
  });

  it('leaves malformed session locks and pre-existing recovery locks untouched', async () => {
    const root = await fixture();
    await writeFile(join(root, 'companion.lock'), 'invalid');
    await expect(acquireSessionLock(root)).rejects.toMatchObject({
      code: 'FETANAGENT_PROFILE_IN_USE',
    });
    expect(await readFile(join(root, 'companion.lock'), 'utf8')).toBe('invalid');
    await writeFile(join(root, 'companion-recovery.lock'), 'manual review');
    await expect(acquireSessionLock(root)).rejects.toMatchObject({
      code: 'FETANAGENT_PROFILE_IN_USE',
    });
    expect(await readFile(join(root, 'companion-recovery.lock'), 'utf8')).toBe('manual review');
  });
});
