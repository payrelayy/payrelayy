import { request as httpRequest } from 'node:http';

import { AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE } from '@fetanagent/agent-platform-companion-contracts';
import {
  COMPANION_EXECUTION_HANDOFF_SIGN_PATH,
  digestCompanionExecutionHandoffSigningContent,
  type SignedCompanionExecutionActivationHandoff,
} from '@fetanagent/agent-platform-companion-execution-contracts';

import type { CompanionDeviceSigningRuntime } from './device-enrollment.js';

const MAX_REQUEST_BYTES = 16 * 1_024;
const MAX_RESPONSE_BYTES = 4_096;
const ROUND_TRIP_TIMEOUT_MS = 10_000;

export class ProtectedHandoffSigningClientUnavailableError extends Error {
  constructor() {
    super('The protected companion handoff signing request is unavailable.');
    this.name = 'ProtectedHandoffSigningClientUnavailableError';
  }
}

function parseReply(bytes: Buffer): SignedCompanionExecutionActivationHandoff {
  const raw = bytes.toString('utf8');
  const value: unknown = JSON.parse(raw);
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'body,signature,signerKeyId' ||
    JSON.stringify(value) !== raw
  )
    throw new Error();
  // The publisher performs the full exact-body, pinned-key, and P-256 check
  // before any local file can be written. This client only transports bytes.
  return value as SignedCompanionExecutionActivationHandoff;
}

async function postOnce(
  port: number,
  body: Buffer,
): Promise<SignedCompanionExecutionActivationHandoff> {
  let timer: NodeJS.Timeout | undefined;
  const response = await new Promise<Buffer>((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: COMPANION_EXECUTION_HANDOFF_SIGN_PATH,
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
          let length = 0;
          try {
            if (
              incoming.statusCode !== 200 ||
              incoming.headers['content-type'] !== AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE ||
              incoming.headers['cache-control'] !== 'no-store'
            )
              throw new Error();
            for await (const value of incoming) {
              const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
              length += chunk.byteLength;
              if (length > MAX_RESPONSE_BYTES) throw new Error();
              chunks.push(Buffer.from(chunk));
            }
            if (length < 2) throw new Error();
            resolve(Buffer.concat(chunks, length));
          } catch {
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
    return parseReply(response);
  } finally {
    response.fill(0);
  }
}

/**
 * One no-retry, loopback-only client for an authenticated operator tunnel.
 * It never accepts a remote URL, puts the paired private key on the wire, or
 * trusts the response as authority until the local publisher verifies it.
 */
export function createProtectedHandoffSigningClient(
  device: Pick<CompanionDeviceSigningRuntime, 'certificate' | 'createSignedHttpRequest'>,
  loopbackPort: number,
): (requestKey: string) => Promise<SignedCompanionExecutionActivationHandoff> {
  if (!Number.isInteger(loopbackPort) || loopbackPort < 1 || loopbackPort > 65535)
    throw new ProtectedHandoffSigningClientUnavailableError();
  let attempted = false;
  return async (requestKey) => {
    try {
      if (attempted) throw new Error();
      const contentDigest = digestCompanionExecutionHandoffSigningContent(
        requestKey,
        device.certificate.bodyDigest,
      );
      if (!contentDigest) throw new Error();
      const signedRequest = device.createSignedHttpRequest(
        COMPANION_EXECUTION_HANDOFF_SIGN_PATH,
        contentDigest,
      );
      const body = Buffer.from(
        JSON.stringify({
          requestKey,
          certificate: device.certificate,
          httpRequest: signedRequest,
        }),
        'utf8',
      );
      if (body.byteLength < 2 || body.byteLength > MAX_REQUEST_BYTES) throw new Error();
      attempted = true;
      try {
        return await postOnce(loopbackPort, body);
      } finally {
        body.fill(0);
      }
    } catch {
      throw new ProtectedHandoffSigningClientUnavailableError();
    }
  };
}
