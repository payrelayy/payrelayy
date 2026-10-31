import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CompanionReleaseUnavailableError,
  fetchCompanionReleaseArchive,
  latestCompanionReleaseAsset,
} from './companion-release-download.js';

const token = `github_pat_${'A'.repeat(60)}`;
const bytes = Buffer.from('test companion archive');
const digest = createHash('sha256').update(bytes).digest('hex');
const immutable = 'FetanAgent-Windows-Companion-316afd6ddc74.zip';

function releaseMetadata() {
  return {
    tag_name: 'windows-companion-v0.1.73',
    draft: false,
    prerelease: false,
    assets: [
      { name: immutable, id: 1, size: bytes.length, digest: `sha256:${digest}` },
      { name: `${immutable}.sha256`, id: 2, size: 113, digest: `sha256:${'a'.repeat(64)}` },
      {
        name: 'FetanAgent-Windows-Companion.zip',
        id: 3,
        size: bytes.length,
        digest: `sha256:${digest}`,
      },
      {
        name: 'FetanAgent-Windows-Companion.zip.sha256',
        id: 4,
        size: 100,
        digest: `sha256:${'b'.repeat(64)}`,
      },
    ],
  };
}

describe('private Companion release download', () => {
  it('accepts one exact published release and verifies bytes without sending the token to the asset CDN', async () => {
    const requests: { url: string; authorization: string | undefined }[] = [];
    const mockFetch = (async (input: string | URL, init?: RequestInit) => {
      const url = input.toString();
      const headers = new Headers(init?.headers);
      requests.push({ url, authorization: headers.get('authorization') ?? undefined });
      if (url.endsWith('/releases/latest'))
        return new Response(JSON.stringify(releaseMetadata()), {
          headers: { 'content-type': 'application/json' },
        });
      if (url.endsWith('/releases/assets/3'))
        return new Response(null, {
          status: 302,
          headers: { location: 'https://release-assets.githubusercontent.com/download/test' },
        });
      return new Response(bytes);
    }) as typeof fetch;
    const asset = await latestCompanionReleaseAsset(token, mockFetch);
    expect(asset).toEqual({ assetId: 3, digest, size: bytes.length });
    expect(await fetchCompanionReleaseArchive(token, asset, mockFetch)).toEqual(bytes);
    expect(requests.map((request) => request.authorization)).toEqual([
      `Bearer ${token}`,
      `Bearer ${token}`,
      undefined,
    ]);
  });

  it('rejects altered release metadata, unsafe redirects, and corrupt archive bytes', async () => {
    const badRelease = releaseMetadata();
    badRelease.assets[2]!.digest = `sha256:${'0'.repeat(64)}`;
    await expect(
      latestCompanionReleaseAsset(
        token,
        (async () =>
          new Response(JSON.stringify(badRelease), {
            headers: { 'content-type': 'application/json' },
          })) as typeof fetch,
      ),
    ).rejects.toBeInstanceOf(CompanionReleaseUnavailableError);

    const asset = { assetId: 3, digest, size: bytes.length };
    const unsafeRedirect = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1/secret' },
      })) as typeof fetch;
    await expect(fetchCompanionReleaseArchive(token, asset, unsafeRedirect)).rejects.toBeInstanceOf(
      CompanionReleaseUnavailableError,
    );
    const corruptBytes = (async () =>
      new Response(Buffer.from('wrong companion bytes'))) as typeof fetch;
    await expect(fetchCompanionReleaseArchive(token, asset, corruptBytes)).rejects.toBeInstanceOf(
      CompanionReleaseUnavailableError,
    );
  });
});
