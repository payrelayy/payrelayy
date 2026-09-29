import { request as httpRequest } from 'node:http';

import {
  AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  type SignedCompanionEnrollmentCertificate,
  type SignedCompanionHttpRequest,
} from '@fetanagent/agent-platform-companion-contracts';
import {
  COMPANION_EXECUTION_HANDOFF_SIGN_PATH,
  COMPANION_EXECUTION_OPERATOR_BOOTSTRAP_PATH,
  COMPANION_EXECUTION_OPERATOR_QUERY_PATH,
} from '@fetanagent/agent-platform-companion-execution-contracts';

import type { GuardedOperatorRemoteSession } from './guarded-operator-query-client.js';
import type { ProtectedOperatorQueryName } from './protected-operator-query-catalog.js';
import {
  decodeProtectedOperatorRows,
  digestProtectedOperatorWireCommand,
  exactRecord,
  type ProtectedOperatorWireCommand,
  type ProtectedOperatorWireOperation,
} from './protected-operator-query-wire.js';

const MAX_BODY_BYTES = 16 * 1_024;
const ROUND_TRIP_TIMEOUT_MS = 10_000;
const NONCE = /^[A-Za-z0-9_-]{43}$/u;

export type ProtectedOperatorPost = (body: Buffer) => Promise<unknown>;

export interface ProtectedOperatorDeviceSigner {
  readonly certificate: SignedCompanionEnrollmentCertificate;
  createSignedHttpRequest(
    path:
      | typeof COMPANION_EXECUTION_OPERATOR_QUERY_PATH
      | typeof COMPANION_EXECUTION_HANDOFF_SIGN_PATH
      | typeof COMPANION_EXECUTION_OPERATOR_BOOTSTRAP_PATH,
    contentDigest: string,
  ): SignedCompanionHttpRequest;
}

export class ProtectedOperatorQueryHttpClientUnavailableError extends Error {
  readonly requiresIndependentStopAndReconciliation = true;

  constructor() {
    super('The protected operator query transport is unavailable.');
    this.name = 'ProtectedOperatorQueryHttpClientUnavailableError';
  }
}

async function postOnce(port: number, body: Buffer): Promise<unknown> {
  let timer: NodeJS.Timeout | undefined;
  const response = await new Promise<Buffer>((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: COMPANION_EXECUTION_OPERATOR_QUERY_PATH,
        method: 'POST',
        agent: false,
        headers: {
          accept: AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
          'content-type': AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
          'content-length': body.byteLength,
        },
      },
      (incoming) => {
        void (async () => {
          const chunks: Buffer[] = [];
          let received = 0;
          try {
            if (
              incoming.statusCode !== 200 ||
              incoming.headers['content-type'] !== AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE ||
              incoming.headers['cache-control'] !== 'no-store'
            )
              throw new Error();
            for await (const value of incoming) {
              const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
              received += chunk.byteLength;
              if (received > MAX_BODY_BYTES) throw new Error();
              chunks.push(Buffer.from(chunk));
            }
            if (received < 2) throw new Error();
            resolve(Buffer.concat(chunks, received));
          } catch {
            incoming.destroy();
            reject(new Error());
          } finally {
            for (const chunk of chunks) chunk.fill(0);
          }
        })();
      },
    );
    timer = setTimeout(() => request.destroy(new Error()), ROUND_TRIP_TIMEOUT_MS);
    request.once('error', () => reject(new Error()));
    request.end(body);
  }).finally(() => clearTimeout(timer));
  try {
    const raw = response.toString('utf8');
    const value: unknown = JSON.parse(raw);
    if (JSON.stringify(value) !== raw) throw new Error();
    return value;
  } finally {
    response.fill(0);
  }
}

async function signedPost(
  device: ProtectedOperatorDeviceSigner,
  post: ProtectedOperatorPost,
  command: ProtectedOperatorWireCommand,
): Promise<unknown> {
  const digest = digestProtectedOperatorWireCommand(command);
  const signed = device.createSignedHttpRequest(COMPANION_EXECUTION_OPERATOR_QUERY_PATH, digest);
  const body = Buffer.from(
    JSON.stringify({ command, certificate: device.certificate, httpRequest: signed }),
    'utf8',
  );
  if (body.byteLength < 2 || body.byteLength > MAX_BODY_BYTES) {
    body.fill(0);
    throw new Error();
  }
  try {
    return await post(body);
  } finally {
    body.fill(0);
  }
}

/**
 * No-retry loopback client. A separately authenticated private tunnel must
 * connect this local port to the protected host's loopback listener. Neither
 * the database credential nor arbitrary SQL crosses to Windows.
 */
export async function createProtectedOperatorHttpRemoteSession(
  device: ProtectedOperatorDeviceSigner,
  requestKey: string,
  loopbackPort: number,
): Promise<GuardedOperatorRemoteSession> {
  if (!Number.isInteger(loopbackPort) || loopbackPort < 1 || loopbackPort > 65535)
    throw new ProtectedOperatorQueryHttpClientUnavailableError();
  return createProtectedOperatorRemoteSessionWithPost(device, requestKey, (body) =>
    postOnce(loopbackPort, body),
  );
}

/** Shared signed, ordered session for a caller-owned authenticated byte transport. */
export async function createProtectedOperatorRemoteSessionWithPost(
  device: ProtectedOperatorDeviceSigner,
  requestKey: string,
  post: ProtectedOperatorPost,
): Promise<GuardedOperatorRemoteSession> {
  try {
    if (
      !device ||
      typeof device.createSignedHttpRequest !== 'function' ||
      typeof post !== 'function'
    )
      throw new Error();
    const openCommand = {
      requestKey,
      sequence: 0,
      name: 'open',
      values: [],
      sessionNonce: null,
    } as const satisfies ProtectedOperatorWireCommand;
    const opened = await signedPost(device, post, openCommand);
    if (
      !exactRecord(opened, ['sequence', 'backendPid', 'sessionNonce']) ||
      opened.sequence !== 0 ||
      !Number.isInteger(opened.backendPid) ||
      (opened.backendPid as number) < 1 ||
      (opened.backendPid as number) > 2_147_483_647 ||
      typeof opened.sessionNonce !== 'string' ||
      !NONCE.test(opened.sessionNonce)
    )
      throw new Error();

    const backendPid = opened.backendPid as number;
    const sessionNonce = opened.sessionNonce as string;
    let sequence = 1;
    let closed = false;
    let failed = false;
    let pending: Promise<unknown> = Promise.resolve();
    let rejectLost!: (error: ProtectedOperatorQueryHttpClientUnavailableError) => void;
    const lost = new Promise<never>((_, reject) => {
      rejectLost = reject;
    });
    void lost.catch(() => undefined);
    const fail = (): ProtectedOperatorQueryHttpClientUnavailableError => {
      if (!failed) {
        failed = true;
        rejectLost(new ProtectedOperatorQueryHttpClientUnavailableError());
      }
      return new ProtectedOperatorQueryHttpClientUnavailableError();
    };
    const send = (name: ProtectedOperatorWireOperation, values: readonly unknown[]) => {
      const task = pending
        .then(async () => {
          if (closed || failed || sequence > 2_147_483_647) throw new Error();
          const currentSequence = sequence++;
          const command: ProtectedOperatorWireCommand = {
            requestKey,
            sequence: currentSequence,
            name,
            values,
            sessionNonce,
          };
          const response = await signedPost(device, post, command);
          if (!response || typeof response !== 'object' || Array.isArray(response))
            throw new Error();
          if ((response as Record<string, unknown>)['sequence'] !== currentSequence)
            throw new Error();
          return response;
        })
        .catch(() => {
          throw fail();
        });
      pending = task.catch(() => undefined);
      return task;
    };

    return Object.freeze({
      backendPid,
      lost,
      async execute(name: ProtectedOperatorQueryName, values: readonly unknown[]) {
        try {
          const response = await send(name, values);
          if (!exactRecord(response, ['sequence', 'rows'])) throw new Error();
          return { rows: decodeProtectedOperatorRows(name, response.rows) };
        } catch {
          throw fail();
        }
      },
      async close(): Promise<void> {
        try {
          if (closed || failed) throw new Error();
          const response = await send('close', []);
          if (!exactRecord(response, ['sequence', 'closed']) || response.closed !== true)
            throw new Error();
          closed = true;
        } catch {
          throw fail();
        }
      },
    });
  } catch {
    throw new ProtectedOperatorQueryHttpClientUnavailableError();
  }
}
