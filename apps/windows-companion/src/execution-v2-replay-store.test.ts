import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import type { CryptographicallyVerifiedOneUseActionAuthority } from '@fetanagent/agent-platform-companion-execution-contracts';

import { consumeWindowsCompanionExecutionV2AuthorityOnce } from './execution-v2-replay-store.js';

const roots: string[] = [];
const sha = (character: string) => `sha256:${character.repeat(64)}`;

function verification(): CryptographicallyVerifiedOneUseActionAuthority {
  return Object.freeze({
    verificationKind: 'cryptographically_verified_one_use_action_authority',
    grantsActionAuthority: false,
    atomicReplayConsumptionRequired: true,
    authorityBodyDigest: sha('a'),
    replayIdentity: sha('b'),
    signedServerActionDeadline: '2026-09-14T00:00:10.000Z',
    monotonicActionDeadlineMs: 10_000,
    verifiedAtTrustedTime: '2026-09-14T00:00:01.000Z',
    responseReceivedMonotonicMs: 1_000,
  });
}

async function dataRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'fetanagent-execution-replay-'));
  roots.push(root);
  await mkdir(resolve(root, 'device'));
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('Windows companion execution-v2 authority replay store', () => {
  it('returns a receipt only for the process that durably creates the marker', async () => {
    const root = await dataRoot();
    const receipt = await consumeWindowsCompanionExecutionV2AuthorityOnce(verification(), {
      dataRoot: root,
      now: () => new Date('2026-09-14T00:00:02.000Z'),
    });
    expect(receipt).toEqual({
      receiptKind: 'external_atomic_replay_consumption',
      replayIdentity: sha('b'),
      authorityBodyDigest: sha('a'),
      consumedExactlyOnce: true,
    });
    const marker = await readFile(
      resolve(
        root,
        'device',
        'execution-v2',
        'consumed-authorities',
        `${'b'.repeat(64)}.consumed.json`,
      ),
      'utf8',
    );
    expect(JSON.parse(marker)).toEqual({
      markerVersion: 2,
      consumedAt: '2026-09-14T00:00:02.000Z',
      ...receipt,
    });
    await expect(
      consumeWindowsCompanionExecutionV2AuthorityOnce(verification(), { dataRoot: root }),
    ).rejects.toThrow('replay protection is unavailable');
  });

  it('allows exactly one winner across concurrent consumers', async () => {
    const root = await dataRoot();
    const outcomes = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        consumeWindowsCompanionExecutionV2AuthorityOnce(verification(), { dataRoot: root }),
      ),
    );
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(7);
  });

  it('rejects malformed verification objects before creating a marker', async () => {
    const root = await dataRoot();
    await expect(
      consumeWindowsCompanionExecutionV2AuthorityOnce(
        { ...verification(), replayIdentity: 'sha256:bad' },
        { dataRoot: root },
      ),
    ).rejects.toThrow();
  });
});
