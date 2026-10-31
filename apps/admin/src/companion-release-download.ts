import { createHash } from 'node:crypto';

const REPOSITORY = ['pay', 'relayy'].join('');
const API_ROOT = `https://api.github.com/repos/${REPOSITORY}/${REPOSITORY}`;
const STABLE_ZIP = 'FetanAgent-Windows-Companion.zip';
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const RELEASE_TAG = /^windows-companion-v[0-9A-Za-z._-]{1,60}$/u;
const SHA256 = /^sha256:([0-9a-f]{64})$/u;

export class CompanionReleaseUnavailableError extends Error {
  constructor() {
    super('The private Companion release is unavailable.');
  }
}

function githubHeaders(token: string, accept: string): Record<string, string> {
  return {
    accept,
    authorization: `Bearer ${token}`,
    'user-agent': 'fetanagent-owner-companion-download',
    'x-github-api-version': '2022-11-28',
  };
}

async function boundedBody(response: Response, limit: number): Promise<Buffer> {
  const advertised = response.headers.get('content-length');
  if (advertised !== null && (!/^\d+$/u.test(advertised) || Number(advertised) > limit))
    throw new CompanionReleaseUnavailableError();
  if (!response.body) throw new CompanionReleaseUnavailableError();
  const parts: Buffer[] = [];
  let bytes = 0;
  for await (const part of response.body) {
    const buffer = Buffer.from(part);
    bytes += buffer.length;
    if (bytes > limit) throw new CompanionReleaseUnavailableError();
    parts.push(buffer);
  }
  return Buffer.concat(parts, bytes);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CompanionReleaseUnavailableError();
  return value as Record<string, unknown>;
}

export interface CompanionReleaseAsset {
  readonly assetId: number;
  readonly digest: string;
  readonly size: number;
}

export async function latestCompanionReleaseAsset(
  token: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<CompanionReleaseAsset> {
  try {
    const response = await fetchImplementation(`${API_ROOT}/releases/latest`, {
      headers: githubHeaders(token, 'application/vnd.github+json'),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'application/json')
      throw new CompanionReleaseUnavailableError();
    const release = object(
      JSON.parse((await boundedBody(response, MAX_METADATA_BYTES)).toString('utf8')),
    );
    if (
      !RELEASE_TAG.test(String(release.tag_name)) ||
      release.draft !== false ||
      release.prerelease !== false
    )
      throw new CompanionReleaseUnavailableError();
    const assets = release.assets;
    if (!Array.isArray(assets) || assets.length !== 4) throw new CompanionReleaseUnavailableError();
    const byName = new Map<string, Record<string, unknown>>();
    for (const asset of assets) {
      const entry = object(asset);
      if (typeof entry.name !== 'string' || byName.has(entry.name))
        throw new CompanionReleaseUnavailableError();
      byName.set(entry.name, entry);
    }
    const immutableNames = [...byName.keys()].filter((name) =>
      /^FetanAgent-Windows-Companion-[0-9a-f]{12}\.zip$/u.test(name),
    );
    if (
      immutableNames.length !== 1 ||
      [...byName.keys()].sort().join(',') !==
        [STABLE_ZIP, `${STABLE_ZIP}.sha256`, immutableNames[0]!, `${immutableNames[0]}.sha256`]
          .sort()
          .join(',')
    )
      throw new CompanionReleaseUnavailableError();
    const zip = byName.get(STABLE_ZIP)!;
    const immutableZip = byName.get(immutableNames[0]!)!;
    const digest = SHA256.exec(String(zip.digest))?.[1];
    if (
      !digest ||
      zip.digest !== immutableZip.digest ||
      !Number.isSafeInteger(zip.id) ||
      (zip.id as number) <= 0 ||
      !Number.isSafeInteger(zip.size) ||
      (zip.size as number) < 1 ||
      (zip.size as number) > MAX_ARCHIVE_BYTES ||
      zip.size !== immutableZip.size
    )
      throw new CompanionReleaseUnavailableError();
    return { assetId: zip.id as number, digest, size: zip.size as number };
  } catch {
    throw new CompanionReleaseUnavailableError();
  }
}

export async function fetchCompanionReleaseArchive(
  token: string,
  asset: CompanionReleaseAsset,
  fetchImplementation: typeof fetch = fetch,
): Promise<Buffer> {
  try {
    const response = await fetchImplementation(`${API_ROOT}/releases/assets/${asset.assetId}`, {
      headers: githubHeaders(token, 'application/octet-stream'),
      redirect: 'manual',
      signal: AbortSignal.timeout(90_000),
    });
    let archive = response;
    if (response.status === 302) {
      const location = new URL(response.headers.get('location') ?? '');
      if (
        location.protocol !== 'https:' ||
        location.hostname !== 'release-assets.githubusercontent.com' ||
        location.username ||
        location.password ||
        location.hash
      )
        throw new CompanionReleaseUnavailableError();
      archive = await fetchImplementation(location, {
        headers: { 'user-agent': 'fetanagent-owner-companion-download' },
        redirect: 'error',
        signal: AbortSignal.timeout(90_000),
      });
    }
    if (!archive.ok || archive.status !== 200) throw new CompanionReleaseUnavailableError();
    const bytes = await boundedBody(archive, MAX_ARCHIVE_BYTES);
    if (
      bytes.length !== asset.size ||
      createHash('sha256').update(bytes).digest('hex') !== asset.digest
    )
      throw new CompanionReleaseUnavailableError();
    return bytes;
  } catch {
    throw new CompanionReleaseUnavailableError();
  }
}

export const companionReleaseArchiveName = STABLE_ZIP;
