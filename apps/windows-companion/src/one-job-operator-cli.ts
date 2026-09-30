import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadWindowsCompanionConfig } from './config.js';
import {
  OneJobOperatorUnavailableError,
  parseOneJobOperatorDocument,
  runOneJobOperator,
  type OneJobOperatorFailureStage,
} from './one-job-operator.js';

const MAX_DOCUMENT_BYTES = 8 * 1_024;

export function redactedOneJobOperatorFailure(
  error: unknown,
  fallbackStage: 'configuration' | OneJobOperatorFailureStage,
): string {
  return JSON.stringify({
    component: 'fetanagent_one_job_operator',
    result: 'stopped',
    failureStage: error instanceof OneJobOperatorUnavailableError ? error.stage : fallbackStage,
    identifiersRedacted: true,
  });
}

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
  let stage: 'configuration' | OneJobOperatorFailureStage = 'configuration';
  try {
    const config = loadWindowsCompanionConfig();
    if (config.executionV2Enabled || config.pairingPackageProvided) throw new Error();
    stage = 'document';
    const document = parseOneJobOperatorDocument(await readDocument());
    stage = 'local_preflight';
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
  } catch (error) {
    // Only a fixed stage is emitted. The original error may contain private
    // request or host details and must never reach a log or terminal.
    console.error(redactedOneJobOperatorFailure(error, stage));
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
