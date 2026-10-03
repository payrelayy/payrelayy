import { isIP } from 'node:net';
import { win32 } from 'node:path';

import {
  GuardedOperatorActivationUnavailableError,
  isGuardedOperatorActivationFailureStage,
  runGuardedOperatorActivationOverSsh,
  type GuardedOperatorActivationFailureStage,
} from '@fetanagent/agent-platform-companion-activation-issuer/guarded-operator-ssh-activation';
import type { ProtectedOperatorSshConnection } from '@fetanagent/agent-platform-companion-activation-issuer/protected-operator-query-ssh-client';
import {
  ProtectedOperatorSshClientUnavailableError,
  readProtectedOperatorSshBootstrap,
} from '@fetanagent/agent-platform-companion-activation-issuer/protected-operator-query-ssh-client';

import {
  loadCompanionDeviceSigningRuntime,
  type CompanionDeviceSigningRuntime,
} from './device-enrollment.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REQUEST_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TAG = /^windows-companion-v[A-Za-z0-9._-]+$/u;
const MAX_DOCUMENT_BYTES = 8 * 1_024;

interface OneJobOperatorCommonDocument {
  readonly releaseTag: string;
  readonly archivePath: string;
  readonly checksumPath: string;
  readonly verifierScriptPath: string;
  readonly powershellExecutable: string;
  readonly processVerifierScriptPath: string;
  readonly connection: ProtectedOperatorSshConnection;
}

export type OneJobOperatorDocument = OneJobOperatorCommonDocument & { readonly version: 2 };

export interface OneJobOperatorContext {
  readonly dataRoot: string;
  readonly installationRoot: string;
  readonly windowsEnvironment: NodeJS.ProcessEnv;
  readonly trustedNow: () => Date;
  readonly signal?: AbortSignal;
}

interface OneJobOperatorAdapters {
  loadDevice(input: { readonly dataRoot: string }): Promise<CompanionDeviceSigningRuntime>;
  bootstrap: typeof readProtectedOperatorSshBootstrap;
  activate: typeof runGuardedOperatorActivationOverSsh;
}

const productionAdapters: OneJobOperatorAdapters = {
  loadDevice: loadCompanionDeviceSigningRuntime,
  bootstrap: readProtectedOperatorSshBootstrap,
  activate: runGuardedOperatorActivationOverSsh,
};

export class OneJobOperatorUnavailableError extends Error {
  readonly requiresIndependentStopAndReconciliation = true;

  constructor(
    readonly stage: OneJobOperatorFailureStage = 'local_preflight',
    readonly activationStage?: GuardedOperatorActivationFailureStage,
  ) {
    super('The one-job operator is unavailable; reconcile before another request.');
    this.name = 'OneJobOperatorUnavailableError';
  }
}

export type OneJobOperatorFailureStage =
  | 'platform'
  | 'document'
  | 'local_preflight'
  | 'device_enrollment'
  | 'bootstrap_local_preflight'
  | 'bootstrap_ssh_transport'
  | 'bootstrap_http_response'
  | 'bootstrap_binding'
  | 'guarded_activation';

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  )
    throw new OneJobOperatorUnavailableError();
  return value as Record<string, unknown>;
}

function canonicalWindowsPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 3 &&
    value.length <= 260 &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    /^[A-Za-z]:\\/u.test(value) &&
    win32.isAbsolute(value) &&
    win32.normalize(value) === value
  );
}

/** Strict, identifier-silent input for one already prepared Owner-approved job. */
export function parseOneJobOperatorDocument(text: string): OneJobOperatorDocument {
  try {
    if (
      typeof text !== 'string' ||
      Buffer.byteLength(text, 'utf8') < 2 ||
      Buffer.byteLength(text, 'utf8') > MAX_DOCUMENT_BYTES
    )
      throw new Error();
    const candidate: unknown = JSON.parse(text);
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error();
    const version = (candidate as Record<string, unknown>).version;
    if (version !== 2) throw new Error();
    const value = record(candidate, [
      'version',
      'releaseTag',
      'archivePath',
      'checksumPath',
      'verifierScriptPath',
      'powershellExecutable',
      'processVerifierScriptPath',
      'connection',
    ]);
    const connection = record(value.connection, [
      'identityFile',
      'knownHostsFile',
      'remoteHostIpv4',
      'remoteUser',
      'remoteSshPort',
      'remoteLoopbackPort',
    ]);
    if (
      typeof value.releaseTag !== 'string' ||
      !TAG.test(value.releaseTag) ||
      !canonicalWindowsPath(value.archivePath) ||
      !canonicalWindowsPath(value.checksumPath) ||
      !canonicalWindowsPath(value.verifierScriptPath) ||
      !canonicalWindowsPath(value.powershellExecutable) ||
      !canonicalWindowsPath(value.processVerifierScriptPath) ||
      !canonicalWindowsPath(connection.identityFile) ||
      !canonicalWindowsPath(connection.knownHostsFile) ||
      typeof connection.remoteHostIpv4 !== 'string' ||
      isIP(connection.remoteHostIpv4) !== 4 ||
      connection.remoteUser !== 'fetanagent-operator' ||
      !Number.isInteger(connection.remoteSshPort) ||
      (connection.remoteSshPort as number) < 1 ||
      (connection.remoteSshPort as number) > 65535 ||
      connection.remoteLoopbackPort !== 743
    )
      throw new Error();
    const common = {
      releaseTag: value.releaseTag,
      archivePath: value.archivePath,
      checksumPath: value.checksumPath,
      verifierScriptPath: value.verifierScriptPath,
      powershellExecutable: value.powershellExecutable,
      processVerifierScriptPath: value.processVerifierScriptPath,
      connection: Object.freeze({
        identityFile: connection.identityFile,
        knownHostsFile: connection.knownHostsFile,
        remoteHostIpv4: connection.remoteHostIpv4,
        remoteUser: connection.remoteUser,
        remoteSshPort: connection.remoteSshPort,
        remoteLoopbackPort: connection.remoteLoopbackPort,
      }) as ProtectedOperatorSshConnection,
    } as OneJobOperatorCommonDocument;
    return Object.freeze({ ...common, version: 2 });
  } catch {
    throw new OneJobOperatorUnavailableError('document');
  }
}

/** Executes no lookup, queue lease, or provider action itself; the guarded child owns one job. */
export async function runOneJobOperatorWithAdapters(
  document: OneJobOperatorDocument,
  context: OneJobOperatorContext,
  adapters: OneJobOperatorAdapters,
): Promise<'confirmed' | 'review_required'> {
  let stage: OneJobOperatorFailureStage = 'local_preflight';
  try {
    if (
      !document ||
      document.version !== 2 ||
      !context ||
      context.signal?.aborted ||
      !canonicalWindowsPath(context.dataRoot) ||
      !canonicalWindowsPath(context.installationRoot) ||
      typeof context.trustedNow !== 'function'
    )
      throw new Error();
    stage = 'device_enrollment';
    const device = await adapters.loadDevice({ dataRoot: context.dataRoot });
    if (context.signal?.aborted) throw new Error();
    stage = 'bootstrap_local_preflight';
    const binding = await adapters.bootstrap(device, document.connection);
    stage = 'bootstrap_binding';
    if (
      context.signal?.aborted ||
      !binding ||
      !REQUEST_KEY.test(binding.requestKey) ||
      !UUID.test(binding.actorAuthUserId)
    )
      throw new Error();
    stage = 'guarded_activation';
    return await adapters.activate(
      {
        requestKey: binding.requestKey,
        actorAuthUserId: binding.actorAuthUserId,
        releaseInputs: {
          releaseTag: document.releaseTag,
          archivePath: document.archivePath,
          checksumPath: document.checksumPath,
          installationRoot: context.installationRoot,
          verifierScriptPath: document.verifierScriptPath,
          powershellExecutable: document.powershellExecutable,
        },
        dataRoot: context.dataRoot,
        processVerifierScriptPath: document.processVerifierScriptPath,
        windowsEnvironment: context.windowsEnvironment,
        trustedNow: context.trustedNow,
        ...(context.signal ? { signal: context.signal } : {}),
      },
      device,
      document.connection,
    );
  } catch (error) {
    if (
      stage === 'bootstrap_local_preflight' &&
      error instanceof ProtectedOperatorSshClientUnavailableError
    ) {
      const bootstrapStage = error.bootstrapStage;
      if (bootstrapStage === 'ssh_transport') stage = 'bootstrap_ssh_transport';
      else if (bootstrapStage === 'http_response') stage = 'bootstrap_http_response';
      else if (bootstrapStage === 'bootstrap_binding') stage = 'bootstrap_binding';
    }
    const activationStage =
      stage === 'guarded_activation' &&
      error instanceof GuardedOperatorActivationUnavailableError &&
      isGuardedOperatorActivationFailureStage(error.activationStage)
        ? error.activationStage
        : undefined;
    throw new OneJobOperatorUnavailableError(stage, activationStage);
  }
}

export function runOneJobOperator(
  document: OneJobOperatorDocument,
  context: OneJobOperatorContext,
): Promise<'confirmed' | 'review_required'> {
  if (process.platform !== 'win32') throw new OneJobOperatorUnavailableError('platform');
  return runOneJobOperatorWithAdapters(document, context, productionAdapters);
}

/** A separate read-only entry point: its adapters contain no activation capability. */
export async function previewOneJobOperatorConnectionWithAdapters(
  document: OneJobOperatorDocument,
  context: OneJobOperatorContext,
  adapters: Pick<OneJobOperatorAdapters, 'loadDevice' | 'bootstrap'>,
): Promise<'connection_ready'> {
  let stage: OneJobOperatorFailureStage = 'local_preflight';
  try {
    if (
      !document ||
      document.version !== 2 ||
      !context ||
      context.signal?.aborted ||
      !canonicalWindowsPath(context.dataRoot) ||
      !canonicalWindowsPath(context.installationRoot) ||
      typeof context.trustedNow !== 'function'
    )
      throw new Error();
    stage = 'device_enrollment';
    const device = await adapters.loadDevice({ dataRoot: context.dataRoot });
    if (context.signal?.aborted) throw new Error();
    stage = 'bootstrap_local_preflight';
    const binding = await adapters.bootstrap(device, document.connection);
    stage = 'bootstrap_binding';
    if (
      context.signal?.aborted ||
      !binding ||
      !REQUEST_KEY.test(binding.requestKey) ||
      !UUID.test(binding.actorAuthUserId)
    )
      throw new Error();
    // The private binding never leaves this function. Do not sign a handoff,
    // create a query session, activate a child, or proceed into execution.
    return 'connection_ready';
  } catch (error) {
    if (
      stage === 'bootstrap_local_preflight' &&
      error instanceof ProtectedOperatorSshClientUnavailableError
    ) {
      if (error.bootstrapStage === 'ssh_transport') stage = 'bootstrap_ssh_transport';
      else if (error.bootstrapStage === 'http_response') stage = 'bootstrap_http_response';
      else if (error.bootstrapStage === 'bootstrap_binding') stage = 'bootstrap_binding';
    }
    throw new OneJobOperatorUnavailableError(stage);
  }
}

export function previewOneJobOperatorConnection(
  document: OneJobOperatorDocument,
  context: OneJobOperatorContext,
): Promise<'connection_ready'> {
  if (process.platform !== 'win32') throw new OneJobOperatorUnavailableError('platform');
  return previewOneJobOperatorConnectionWithAdapters(document, context, {
    loadDevice: loadCompanionDeviceSigningRuntime,
    bootstrap: readProtectedOperatorSshBootstrap,
  });
}
