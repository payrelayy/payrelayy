import type {
  CompanionActivationReleaseAttestation,
  CompanionActivationRequestSnapshot,
} from '@fetanagent/agent-platform-companion-execution-contracts';

const RELEASE_TAG = /^windows-companion-v[0-9A-Za-z._-]{1,60}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const REPOSITORY = ['pay', 'relayy'].join('');
const API_ROOT = `https://api.github.com/repos/${REPOSITORY}/${REPOSITORY}`;
const MAX_BODY_BYTES = 64 * 1024;

interface GitHubObject {
  readonly type: string;
  readonly sha: string;
}

type ReadJson = (url: string) => Promise<unknown>;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  return value as Record<string, unknown>;
}

async function githubJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'fetanagent-protected-operator-host',
      'x-github-api-version': '2022-11-28',
    },
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  });
  if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'application/json')
    throw new Error();
  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (!Number.isFinite(declaredLength) || declaredLength > MAX_BODY_BYTES || !response.body)
    throw new Error();
  const parts: Buffer[] = [];
  let length = 0;
  for await (const part of response.body) {
    const bytes = Buffer.from(part);
    length += bytes.byteLength;
    if (length > MAX_BODY_BYTES) throw new Error();
    parts.push(bytes);
  }
  if (length < 2) throw new Error();
  return JSON.parse(Buffer.concat(parts, length).toString('utf8')) as unknown;
}

async function taggedCommit(tag: string, read: ReadJson): Promise<string> {
  const reference = record(await read(`${API_ROOT}/git/ref/tags/${encodeURIComponent(tag)}`));
  let object = record(reference['object']) as unknown as GitHubObject;
  if (object.type === 'tag') {
    if (!SHA.test(object.sha)) throw new Error();
    const annotated = record(await read(`${API_ROOT}/git/tags/${object.sha}`));
    object = record(annotated['object']) as unknown as GitHubObject;
  }
  if (object.type !== 'commit' || !SHA.test(object.sha)) throw new Error();
  return object.sha;
}

/**
 * The protected host checks the public immutable release and tag itself. The
 * Windows operator separately verifies the published attestation and measured
 * installation tree; this server never trusts a Windows-supplied archive hash.
 */
export async function verifyPublishedCompanionReleaseWithReader(
  request: CompanionActivationRequestSnapshot,
  tag: string,
  trustedNow: () => Date,
  read: ReadJson,
): Promise<CompanionActivationReleaseAttestation> {
  try {
    if (
      !RELEASE_TAG.test(tag) ||
      !SHA.test(request.companionReleaseSha) ||
      !DIGEST.test(request.companionArchiveSha256) ||
      !DIGEST.test(request.companionInstallationTreeSha256) ||
      (await taggedCommit(tag, read)) !== request.companionReleaseSha
    )
      throw new Error();
    const release = record(await read(`${API_ROOT}/releases/tags/${encodeURIComponent(tag)}`));
    if (
      release['tag_name'] !== tag ||
      release['draft'] !== false ||
      release['prerelease'] !== false
    )
      throw new Error();
    const assets = release['assets'];
    if (!Array.isArray(assets) || assets.length !== 4) throw new Error();
    const byName = new Map<string, Record<string, unknown>>();
    for (const asset of assets) {
      const entry = record(asset);
      if (typeof entry['name'] !== 'string' || byName.has(entry['name'])) throw new Error();
      byName.set(entry['name'], entry);
    }
    const immutable = `FetanAgent-Windows-Companion-${request.companionReleaseSha.slice(0, 12)}.zip`;
    const stable = 'FetanAgent-Windows-Companion.zip';
    if (
      [...byName.keys()].sort().join(',') !==
        [immutable, `${immutable}.sha256`, stable, `${stable}.sha256`].sort().join(',') ||
      byName.get(immutable)?.['digest'] !== request.companionArchiveSha256 ||
      byName.get(stable)?.['digest'] !== request.companionArchiveSha256 ||
      !Number.isInteger(byName.get(immutable)?.['size']) ||
      byName.get(immutable)?.['size'] !== byName.get(stable)?.['size']
    )
      throw new Error();
    const now = trustedNow();
    const requested = Date.parse(request.requestedAt);
    const expiry = Date.parse(request.expiresAt);
    if (
      !(now instanceof Date) ||
      !Number.isFinite(now.getTime()) ||
      !Number.isFinite(requested) ||
      !Number.isFinite(expiry) ||
      now.getTime() < requested ||
      now.getTime() >= expiry
    )
      throw new Error();
    return Object.freeze({
      releaseSha: request.companionReleaseSha,
      archiveSha256: request.companionArchiveSha256,
      installationTreeSha256: request.companionInstallationTreeSha256,
      observedAt: now.toISOString(),
    });
  } catch {
    throw new Error('The published companion release could not be verified.');
  }
}

export function verifyPublishedCompanionRelease(
  request: CompanionActivationRequestSnapshot,
  tag: string,
  trustedNow: () => Date,
): Promise<CompanionActivationReleaseAttestation> {
  return verifyPublishedCompanionReleaseWithReader(request, tag, trustedNow, githubJson);
}
