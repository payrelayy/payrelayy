import { describe, expect, it } from 'vitest';

import {
  KEMERBET_READINESS_LAYER7_AUTHORIZATIONS_CONTRACT,
  KemerBetReadinessLayer7AuthorizationsUnavailableError,
  loadKemerBetReadinessLayer7Authorizations,
} from './kemerbet-readiness-layer7-authorizations.js';

const token = (sequence: number, nonce = 'a'.repeat(32)) =>
  `v1.${nonce}.${sequence}.${String(sequence).repeat(64)}`;

function fileSystem(
  serialized: string,
  overrides: { readonly mode?: number; readonly uid?: number } = {},
) {
  const stat = {
    dev: 1,
    gid: overrides.uid ?? 10002,
    ino: 2,
    mode: overrides.mode ?? 0o100400,
    nlink: 1,
    size: Buffer.byteLength(serialized),
    uid: overrides.uid ?? 10002,
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

describe('KemerBet readiness pre-minted Layer-7 authorizations', () => {
  it('loads exactly five token-only lines with a common nonce and ordered sequences', async () => {
    const serialized = `${[1, 2, 3, 4, 5].map((sequence) => token(sequence)).join('\n')}\n`;
    const result = await loadKemerBetReadinessLayer7Authorizations({
      effectiveUserId: 10002,
      fileSystem: fileSystem(serialized),
    });

    expect(result.authorizations).toEqual([1, 2, 3, 4, 5].map((sequence) => token(sequence)));
    expect(serialized).not.toContain('PLAYER');
    expect(Buffer.byteLength(serialized)).toBe(
      KEMERBET_READINESS_LAYER7_AUTHORIZATIONS_CONTRACT.bytes,
    );
  });

  it.each([
    ['wrong sequence', [token(1), token(2), token(4), token(4), token(5)].join('\n') + '\n'],
    [
      'mixed nonce',
      [token(1), token(2), token(3, 'b'.repeat(32)), token(4), token(5)].join('\n') + '\n',
    ],
    ['missing final LF', [1, 2, 3, 4, 5].map((sequence) => token(sequence)).join('\n')],
  ])('rejects %s', async (_label, serialized) => {
    await expect(
      loadKemerBetReadinessLayer7Authorizations({
        effectiveUserId: 10002,
        fileSystem: fileSystem(serialized),
      }),
    ).rejects.toBeInstanceOf(KemerBetReadinessLayer7AuthorizationsUnavailableError);
  });

  it('rejects any owner or mode other than controller 10002:10002 mode 0400', async () => {
    const serialized = `${[1, 2, 3, 4, 5].map((sequence) => token(sequence)).join('\n')}\n`;
    await expect(
      loadKemerBetReadinessLayer7Authorizations({
        effectiveUserId: 10002,
        fileSystem: fileSystem(serialized, { mode: 0o100444, uid: 0 }),
      }),
    ).rejects.toBeInstanceOf(KemerBetReadinessLayer7AuthorizationsUnavailableError);
  });
});
