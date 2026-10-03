import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderProductionOperatorLaunch } from './render-production-operator-launch.mjs';

export async function renderActivationDiagnosticDelivery(raw) {
  if (!Buffer.isBuffer(raw) || raw.length === 0 || raw.length > 16 * 1024) {
    throw new Error('Read-only diagnostic delivery unavailable.');
  }
  let document;
  try {
    document = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new Error('Read-only diagnostic delivery unavailable.');
  }
  const keys = ['version', 'requestKey', 'databaseUrl', 'databaseCaPem', 'releaseTag'];
  if (
    document === null ||
    Array.isArray(document) ||
    Object.keys(document).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(document, key)) ||
    document.version !== 1 ||
    typeof document.requestKey !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      document.requestKey,
    ) ||
    document.releaseTag !== 'windows-companion-v0.1.17'
  ) {
    throw new Error('Read-only diagnostic delivery unavailable.');
  }
  try {
    const url = new URL(document.databaseUrl);
    const validated = JSON.parse(
      renderProductionOperatorLaunch({
        PRODUCTION_COMPANION_EXECUTION_REQUEST_KEY: document.requestKey,
        SUPABASE_DB_PASSWORD: decodeURIComponent(url.password),
        SUPABASE_CA_CERTIFICATE_PEM: document.databaseCaPem,
        PRODUCTION_COMPANION_RELEASE_TAG: document.releaseTag,
      }),
    );
    if (keys.some((key) => document[key] !== validated[key])) {
      throw new Error('Read-only diagnostic delivery unavailable.');
    }
  } catch {
    throw new Error('Read-only diagnostic delivery unavailable.');
  }
  const source = await readFile(
    new URL('./deliver-activation-diagnostic-document.py', import.meta.url),
    'utf8',
  );
  // Base64 is data in a fixed Python program, never interpreted as code.
  // The output is private SSH stdin only; no log, artifact, or launch file.
  return (
    "import base64\ndocument_bytes=base64.b64decode('" + raw.toString('base64') + "')\n" + source
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  let raw;
  const chunks = [];
  try {
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 16 * 1024) throw new Error('Read-only diagnostic delivery unavailable.');
      chunks.push(chunk);
    }
    raw = Buffer.concat(chunks);
    process.stdout.write(await renderActivationDiagnosticDelivery(raw));
  } catch {
    process.stderr.write('Read-only diagnostic delivery unavailable.\n');
    process.exitCode = 1;
  } finally {
    raw?.fill(0);
    for (const chunk of chunks) chunk.fill(0);
  }
}
