import { pathToFileURL } from 'node:url';

import { measureWindowsCompanionInstallationTree } from './installation-tree.js';

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  const root = process.argv[2];
  if (root === undefined || process.argv.length !== 3) {
    throw new Error('Expected exactly one Windows companion installation root.');
  }
  process.stdout.write(await measureWindowsCompanionInstallationTree(root));
}
