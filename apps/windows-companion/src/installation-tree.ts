import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const INSTALLATION_TREE_DIGEST_FILE = 'INSTALLATION_TREE_SHA256';
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const MAX_ENTRIES = 100_000;

function invalidInstallation(): never {
  throw new Error('The Windows companion installation is not the signed release.');
}

/** Hash every installed release file, except the file containing this digest. */
export async function measureWindowsCompanionInstallationTree(root: string): Promise<string> {
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return invalidInstallation();
  const treeHash = createHash('sha256');
  treeHash.update('fetanagent:windows-companion:installation-tree:v1\0');
  let entryCount = 0;
  async function visit(directory: string, relativeDirectory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      if (relativeDirectory === '' && entry.name === INSTALLATION_TREE_DIGEST_FILE) continue;
      entryCount += 1;
      if (entryCount > MAX_ENTRIES || entry.name.includes('\0')) return invalidInstallation();
      const path = join(directory, entry.name);
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) return invalidInstallation();
      if (stat.isDirectory()) {
        await visit(path, relativePath);
      } else if (stat.isFile()) {
        const fileHash = createHash('sha256');
        for await (const chunk of createReadStream(path)) fileHash.update(chunk);
        treeHash.update(JSON.stringify([relativePath, fileHash.digest('hex')]));
        treeHash.update('\n');
      } else {
        return invalidInstallation();
      }
    }
  }
  await visit(root, '');
  return `sha256:${treeHash.digest('hex')}`;
}

/** A signed handoff must match both the release marker and the measured local tree. */
export async function verifyWindowsCompanionInstallationTree(
  root: string,
  releaseSha: string,
  signedTreeDigest: string,
): Promise<void> {
  try {
    if (!DIGEST.test(signedTreeDigest)) return invalidInstallation();
    const [releaseStat, manifestStat, releaseBytes, manifestBytes] = await Promise.all([
      lstat(join(root, 'RELEASE_SHA')),
      lstat(join(root, INSTALLATION_TREE_DIGEST_FILE)),
      readFile(join(root, 'RELEASE_SHA')),
      readFile(join(root, INSTALLATION_TREE_DIGEST_FILE)),
    ]);
    if (
      !releaseStat.isFile() ||
      releaseStat.isSymbolicLink() ||
      !manifestStat.isFile() ||
      manifestStat.isSymbolicLink() ||
      releaseBytes.toString('utf8') !== releaseSha ||
      manifestBytes.toString('utf8') !== signedTreeDigest ||
      (await measureWindowsCompanionInstallationTree(root)) !== signedTreeDigest
    ) {
      return invalidInstallation();
    }
  } catch {
    return invalidInstallation();
  }
}
