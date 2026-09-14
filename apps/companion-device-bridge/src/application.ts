import { createHash } from 'node:crypto';
import type { Server } from 'node:http';

import {
  AGENT_PLATFORM_COMPANION_LOOKUP_POLL_PATH,
  AGENT_PLATFORM_COMPANION_LOOKUP_RESULT_PATH,
} from '@fetanagent/agent-platform-companion-contracts';
import {
  COMPANION_EXECUTION_AUTHORITY_PATH,
  COMPANION_EXECUTION_POLL_PATH,
  COMPANION_EXECUTION_RESULT_PATH,
  COMPANION_EXECUTION_STATUS_PATH,
} from '@fetanagent/agent-platform-companion-execution-contracts';

import type { CompanionDeviceBridgeConfig } from './config.js';
import { createCompanionExecutionHandler } from './execution-handler.js';
import { createCompanionLookupHandler } from './lookup-handler.js';
import { createCompanionPairingHandler } from './pairing-handler.js';
import {
  createCompanionDeviceBridgePostgresRuntime,
  type CompanionDeviceBridgePostgresRuntime,
} from './postgres-runtime.js';
import {
  COMPANION_DEVICE_BRIDGE_LISTEN_HOST,
  COMPANION_DEVICE_BRIDGE_LISTEN_PORT,
  createCompanionDeviceBridgeHttpServer,
  type CompanionDeviceBridgeHandler,
} from './server.js';

type EnabledConfig = Extract<CompanionDeviceBridgeConfig, { readonly enabled: true }>;

export interface CompanionDeviceBridgeServerRuntime {
  readonly server: Pick<Server, 'listening'>;
  listen(): Promise<void>;
  ready(): boolean;
  close(): Promise<void>;
}

export interface CompanionDeviceBridgeApplicationDependencies {
  readonly createPostgresRuntime?: (
    config: EnabledConfig['connection'],
    signerKeyId: string,
    executionSignerKeyId?: string,
  ) => Promise<CompanionDeviceBridgePostgresRuntime>;
  readonly createServer?: (
    handler: CompanionDeviceBridgeHandler,
  ) => CompanionDeviceBridgeServerRuntime;
  readonly now?: () => string;
}

export interface CompanionDeviceBridgeApplication {
  ready(): Promise<boolean>;
  close(): Promise<void>;
}

export class CompanionDeviceBridgeApplicationError extends Error {
  constructor() {
    super('The companion device bridge application is unavailable.');
    this.name = 'CompanionDeviceBridgeApplicationError';
  }
}

async function closeRuntimes(
  server: CompanionDeviceBridgeServerRuntime | undefined,
  postgres: CompanionDeviceBridgePostgresRuntime | undefined,
): Promise<void> {
  let failed = false;
  try {
    await server?.close();
  } catch {
    failed = true;
  }
  try {
    await postgres?.close();
  } catch {
    failed = true;
  }
  if (failed) throw new CompanionDeviceBridgeApplicationError();
}

export async function startCompanionDeviceBridgeApplication(
  config: CompanionDeviceBridgeConfig,
  dependencies: CompanionDeviceBridgeApplicationDependencies = {},
): Promise<CompanionDeviceBridgeApplication> {
  if (!config.enabled) throw new CompanionDeviceBridgeApplicationError();
  const createPostgresRuntime =
    dependencies.createPostgresRuntime ??
    ((connection, signerKeyId, executionSignerKeyId) =>
      createCompanionDeviceBridgePostgresRuntime(
        connection,
        signerKeyId,
        executionSignerKeyId === undefined ? {} : { executionSignerKeyId },
      ));
  const createServer =
    dependencies.createServer ??
    ((handler: CompanionDeviceBridgeHandler) =>
      createCompanionDeviceBridgeHttpServer(handler, {
        host: COMPANION_DEVICE_BRIDGE_LISTEN_HOST,
        port: COMPANION_DEVICE_BRIDGE_LISTEN_PORT,
      }));
  let postgres: CompanionDeviceBridgePostgresRuntime | undefined;
  let server: CompanionDeviceBridgeServerRuntime | undefined;
  try {
    postgres = await createPostgresRuntime(
      config.connection,
      config.signer.keyId,
      config.execution.enabled ? config.execution.signer.keyId : undefined,
    );
    if (!(await postgres.ready())) throw new Error();
    const state = postgres.state;
    const pairingHandler = createCompanionPairingHandler({
      signer: config.signer,
      now: dependencies.now ?? (() => new Date().toISOString()),
      claimPairing: (request, assessedAt) => state.claimPairing(request, assessedAt),
      completePairing: (bodyDigest, certificate) => state.completePairing(bodyDigest, certificate),
      releasePairing: (bodyDigest) => state.releasePairing(bodyDigest),
    });
    const lookupHandler = createCompanionLookupHandler({
      signer: config.signer,
      now: dependencies.now ?? (() => new Date().toISOString()),
      claimAssignment: (certificate, request, replayIdentity, assessedAt) =>
        state.claimLookupAssignment(certificate, request, replayIdentity, assessedAt),
      completeAssignment: (bodyDigest, assignment) =>
        state.completeLookupAssignment(bodyDigest, assignment),
      releaseAssignment: (assignmentId) => state.releaseLookupAssignment(assignmentId),
      acceptResult: (
        certificate,
        request,
        httpReplayIdentity,
        assignment,
        result,
        resultReplayIdentity,
        assessedAt,
      ) =>
        state.acceptLookupResult(
          certificate,
          request,
          httpReplayIdentity,
          assignment,
          result,
          resultReplayIdentity,
          assessedAt,
        ),
    });
    const executionConfig = config.execution;
    const executionHandler = executionConfig.enabled
      ? createCompanionExecutionHandler({
          noMoneySigner: config.signer,
          executionSigner: executionConfig.signer,
          now: dependencies.now ?? (() => new Date().toISOString()),
          claimAssignment: (certificate, request, httpReplayIdentity, assessedAt) =>
            state.claimExecutionAssignment(
              certificate,
              request,
              httpReplayIdentity,
              assessedAt,
              Buffer.from(executionConfig.signer.publicKeySpkiDer).toString('base64url'),
              `sha256:${createHash('sha256')
                .update(executionConfig.signer.publicKeySpkiDer)
                .digest('hex')}`,
            ),
          completeAssignment: (
            enrollmentBodyDigest,
            enrollment,
            assignmentBodyDigest,
            assignment,
          ) =>
            state.completeExecutionAssignment(
              enrollmentBodyDigest,
              enrollment,
              assignmentBodyDigest,
              assignment,
            ),
          claimAuthority: (
            certificate,
            request,
            httpReplayIdentity,
            enrollment,
            assignment,
            requestNonceDigest,
            assessedAt,
          ) =>
            state.claimExecutionAuthority(
              certificate,
              request,
              httpReplayIdentity,
              enrollment,
              assignment,
              requestNonceDigest,
              assessedAt,
            ),
          completeAuthority: (authorityBodyDigest, authority) =>
            state.completeExecutionAuthority(authorityBodyDigest, authority),
          acceptResult: (
            certificate,
            request,
            httpReplayIdentity,
            enrollment,
            assignment,
            authority,
            result,
            assessedAt,
          ) =>
            state.acceptExecutionResult(
              certificate,
              request,
              httpReplayIdentity,
              enrollment,
              assignment,
              authority,
              result,
              assessedAt,
            ),
          claimStatus: (
            certificate,
            request,
            httpReplayIdentity,
            enrollment,
            assignment,
            authority,
            result,
            queryNonceDigest,
            assessedAt,
          ) =>
            state.claimExecutionStatus(
              certificate,
              request,
              httpReplayIdentity,
              enrollment,
              assignment,
              authority,
              result,
              queryNonceDigest,
              assessedAt,
            ),
          completeStatus: (statusBodyDigest, status) =>
            state.completeExecutionStatus(statusBodyDigest, status),
        })
      : undefined;
    const handler: CompanionDeviceBridgeHandler = (request) =>
      request.path === AGENT_PLATFORM_COMPANION_LOOKUP_POLL_PATH ||
      request.path === AGENT_PLATFORM_COMPANION_LOOKUP_RESULT_PATH
        ? lookupHandler(request)
        : executionHandler &&
            (request.path === COMPANION_EXECUTION_POLL_PATH ||
              request.path === COMPANION_EXECUTION_AUTHORITY_PATH ||
              request.path === COMPANION_EXECUTION_RESULT_PATH ||
              request.path === COMPANION_EXECUTION_STATUS_PATH)
          ? executionHandler(request)
          : pairingHandler(request);
    server = createServer(handler);
    await server.listen();
    if (!server.ready() || !server.server.listening || !(await postgres.ready())) {
      throw new Error();
    }
  } catch {
    await closeRuntimes(server, postgres).catch(() => undefined);
    throw new CompanionDeviceBridgeApplicationError();
  }

  const activeServer = server;
  const activePostgres = postgres;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    async ready() {
      if (closed || !activeServer.ready() || !activeServer.server.listening) return false;
      try {
        return await activePostgres.ready();
      } catch {
        return false;
      }
    },
    close() {
      closePromise ??= (async () => {
        closed = true;
        await closeRuntimes(activeServer, activePostgres);
      })();
      return closePromise;
    },
  });
}
