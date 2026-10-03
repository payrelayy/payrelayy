import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isGuardedOperatorActivationFailureStage } from '@fetanagent/agent-platform-companion-activation-issuer/guarded-operator-ssh-activation';

import { loadWindowsCompanionConfig } from './config.js';
import {
  OneJobOperatorUnavailableError,
  parseOneJobOperatorDocument,
  previewOneJobOperatorConnection,
  runOneJobOperator,
  type OneJobOperatorContext,
  type OneJobOperatorDocument,
  type OneJobOperatorFailureStage,
} from './one-job-operator.js';

const MAX_DOCUMENT_BYTES = 8 * 1_024;

export type OneJobOperatorMode = 'execute' | 'preview_connection';

export function parseOneJobOperatorArguments(args: readonly string[]): OneJobOperatorMode {
  if (args.length === 0) return 'execute';
  if (args.length === 1 && args[0] === '--preview-connection') return 'preview_connection';
  throw new Error('Unsupported one-job operator mode.');
}

export function runOneJobOperatorCommand(
  document: OneJobOperatorDocument,
  context: OneJobOperatorContext,
  mode: OneJobOperatorMode,
): Promise<'connection_ready' | 'confirmed' | 'review_required'> {
  if (mode === 'preview_connection') return previewOneJobOperatorConnection(document, context);
  if (mode === 'execute') return runOneJobOperator(document, context);
  throw new Error('Unsupported one-job operator mode.');
}

export function redactedOneJobOperatorFailure(
  error: unknown,
  fallbackStage: 'configuration' | OneJobOperatorFailureStage,
): string {
  const activationStage =
    error instanceof OneJobOperatorUnavailableError &&
    error.stage === 'guarded_activation' &&
    isGuardedOperatorActivationFailureStage(error.activationStage)
      ? error.activationStage
      : undefined;
  return JSON.stringify({
    component: 'fetanagent_one_job_operator',
    result: 'stopped',
    failureStage: error instanceof OneJobOperatorUnavailableError ? error.stage : fallbackStage,
    ...(activationStage ? { activationStage } : {}),
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
    const mode = parseOneJobOperatorArguments(process.argv.slice(2));
    const config = loadWindowsCompanionConfig();
    if (config.executionV2Enabled || config.pairingPackageProvided) throw new Error();
    stage = 'document';
    const document = parseOneJobOperatorDocument(await readDocument());
    stage = 'local_preflight';
    const installationRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const result = await runOneJobOperatorCommand(
      document,
      {
        dataRoot: config.dataRoot,
        installationRoot,
        windowsEnvironment: process.env,
        trustedNow: () => new Date(),
        signal: controller.signal,
      },
      mode,
    );
    console.info(
      JSON.stringify({
        component: 'fetanagent_one_job_operator',
        result,
        ...(mode === 'preview_connection'
          ? {
              requestCreated: false,
              handoffSigned: false,
              executionEnabled: false,
              jobApproved: false,
              moneyMoved: false,
            }
          : {}),
        identifiersRedacted: true,
      }),
    );
    if (result === 'review_required') process.exitCode = 2;
  } catch (error) {
    // Only fixed stage categories are emitted. The original error may contain private
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
