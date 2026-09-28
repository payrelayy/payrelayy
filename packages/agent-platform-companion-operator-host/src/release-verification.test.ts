import type { CompanionActivationRequestSnapshot } from '@fetanagent/agent-platform-companion-execution-contracts';
import { describe, expect, it, vi } from 'vitest';

import { verifyPublishedCompanionReleaseWithReader } from './release-verification.js';

const now = new Date('2026-09-28T12:01:00.000Z');
const sha = 'a'.repeat(40);
const archiveDigest = `sha256:${'b'.repeat(64)}`;
const treeDigest = `sha256:${'c'.repeat(64)}`;
const tag = 'windows-companion-v0.1.12';
const request = {
  requestKey: '00000000-0000-4000-8000-000000000001',
  pilotRevisionId: '00000000-0000-4000-8000-000000000002',
  activationEpoch: '1',
  certificateId: '00000000-0000-4000-8000-000000000003',
  platformAgentAccountId: '00000000-0000-4000-8000-000000000004',
  companionReleaseSha: sha,
  companionArchiveSha256: archiveDigest,
  companionInstallationTreeSha256: treeDigest,
  requestedAt: '2026-09-28T12:00:00.000Z',
  expiresAt: '2026-09-28T12:10:00.000Z',
} satisfies CompanionActivationRequestSnapshot;

function reader(change?: { tagSha?: string; archiveDigest?: string; assets?: unknown[] }) {
  const immutable = `FetanAgent-Windows-Companion-${sha.slice(0, 12)}.zip`;
  const assets = change?.assets ?? [
    { name: immutable, digest: change?.archiveDigest ?? archiveDigest, size: 40000000 },
    { name: `${immutable}.sha256`, digest: `sha256:${'d'.repeat(64)}`, size: 120 },
    { name: 'FetanAgent-Windows-Companion.zip', digest: archiveDigest, size: 40000000 },
    {
      name: 'FetanAgent-Windows-Companion.zip.sha256',
      digest: `sha256:${'e'.repeat(64)}`,
      size: 110,
    },
  ];
  return vi.fn(async (url: string): Promise<unknown> => {
    if (url.endsWith(`/git/ref/tags/${tag}`))
      return { object: { type: 'tag', sha: 'f'.repeat(40) } };
    if (url.endsWith(`/git/tags/${'f'.repeat(40)}`))
      return { object: { type: 'commit', sha: change?.tagSha ?? sha } };
    if (url.endsWith(`/releases/tags/${tag}`))
      return { tag_name: tag, draft: false, prerelease: false, assets };
    throw new Error();
  });
}

describe('protected host published release verification', () => {
  it('binds the exact tag commit and two public archive digests to the immutable request', async () => {
    const read = reader();
    await expect(
      verifyPublishedCompanionReleaseWithReader(request, tag, () => now, read),
    ).resolves.toEqual({
      releaseSha: sha,
      archiveSha256: archiveDigest,
      installationTreeSha256: treeDigest,
      observedAt: now.toISOString(),
    });
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('rejects a changed tag commit, mismatched archive, and extra release asset', async () => {
    for (const read of [
      reader({ tagSha: '1'.repeat(40) }),
      reader({ archiveDigest: `sha256:${'0'.repeat(64)}` }),
      reader({ assets: [] }),
    ]) {
      await expect(
        verifyPublishedCompanionReleaseWithReader(request, tag, () => now, read),
      ).rejects.toThrow('The published companion release could not be verified.');
    }
  });

  it('does not contact GitHub for an invalid tag and fails after request expiry', async () => {
    const read = reader();
    await expect(
      verifyPublishedCompanionReleaseWithReader(request, '../main', () => now, read),
    ).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    await expect(
      verifyPublishedCompanionReleaseWithReader(
        request,
        tag,
        () => new Date(request.expiresAt),
        read,
      ),
    ).rejects.toThrow();
  });
});
