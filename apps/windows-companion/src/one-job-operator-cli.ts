import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadWindowsCompanionConfig } from './config.js';
import { parseOneJobOperatorDocument, runOneJobOperator } from './one-job-operator.js';

const MAX_DOCUMENT_BYTES = 8 * 1_024;

async function readDocument(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const value of process.stdin) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      size += chunk.byteLength;
      if (size > MAX_DOCUMENT_BYTES) throw new Error();
      chunks.push(Buffer.from(chunk));
    }
    if (size < 2) throw new Error();
    const combined = Buffer.concat(chunks, size);
    try {
      return combined.toString('utf8').trim();
    } finally {
      combined.fill(0);
    }
  } finally {
    for (const chunk of chunks) chunk.fill(0);
  }
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const onStop = (): void => controller.abort();
  process.once('SIGINT', onStop);
  process.once('SIGTERM', onStop);
  try {
    const config = loadWindowsCompanionConfig();
    if (config.executionV2Enabled || config.pairingPackageProvided) throw new Error();
    const document = parseOneJobOperatorDocument(await readDocument());
    const installationRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const result = await runOneJobOperator(document, {
      dataRoot: config.dataRoot,
      installationRoot,
      windowsEnvironment: process.env,
      trustedNow: () => new Date(),
      signal: controller.signal,
    });
    console.info(
      JSON.stringify({
        component: 'fetanagent_one_job_operator',
        result,
        identifiersRedacted: true,
      }),
    );
    if (result === 'review_required') process.exitCode = 2;
  } catch {
    console.error('The one-job operator stopped; reconcile the exact job before another request.');
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', onStop);
    process.removeListener('SIGTERM', onStop);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main();
}
