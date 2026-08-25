import { describe, expect, it } from 'vitest';

import {
  KemerBetReadinessAccountIdUnavailableError,
  loadKemerBetReadinessAccountId,
} from './kemerbet-readiness-account-id.js';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

function fileSystem(serialized: string, mode = 0o100400) {
  const stat = {
    dev: 1,
    gid: 10001,
    ino: 2,
    mode,
    nlink: 1,
    size: Buffer.byteLength(serialized),
    uid: 10001,
    isFile: () => true,
    isSymbolicLink: () => false,
  };
  return {
    lstat: async () => stat,
    open: async () =>
      ({
        close: async () => undefined,
        readFile: async () => serialized,
        stat: async () => stat,
      }) as never,
    realpath: async (path: string) => path,
  };
}

describe('KemerBet readiness browser account-id secret', () => {
  it('loads only an exact browser-owned UUID+LF file', async () => {
    await expect(
      loadKemerBetReadinessAccountId({
        effectiveUserId: 10001,
        fileSystem: fileSystem(`${ACCOUNT_ID}\n`),
      }),
    ).resolves.toBe(ACCOUNT_ID);
  });

  it.each([
    ['missing LF', ACCOUNT_ID],
    ['uppercase', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA\n'],
  ])('rejects %s', async (_label, serialized) => {
    await expect(
      loadKemerBetReadinessAccountId({
        effectiveUserId: 10001,
        fileSystem: fileSystem(serialized),
      }),
    ).rejects.toBeInstanceOf(KemerBetReadinessAccountIdUnavailableError);
  });

  it('rejects a group-readable account-id copy', async () => {
    await expect(
      loadKemerBetReadinessAccountId({
        effectiveUserId: 10001,
        fileSystem: fileSystem(`${ACCOUNT_ID}\n`, 0o100440),
      }),
    ).rejects.toBeInstanceOf(KemerBetReadinessAccountIdUnavailableError);
  });
});
