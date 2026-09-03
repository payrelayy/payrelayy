import { request as httpRequest, type IncomingMessage } from 'node:http';
import { isProxy } from 'node:util/types';

import {
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTENT_TYPE,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTRACT_VERSION,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_MAX_REQUEST_BYTES,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_MAX_RESPONSE_BYTES,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_NO_MONEY_SAFETY,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_POLL_PATH,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROTOCOL_MODE,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROVIDER_CODE,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_SOCKET,
  TELEBIRR_DEVICE_BRIDGE_ASSIGNMENT_POLL_PATH,
  decodeSignedTelebirrDeviceBridgeRequest,
  decodeTelebirrAssignmentBrokerLocalPollResponseBytes,
  digestTelebirrDeviceBridgePayload,
  digestTelebirrDeviceBridgeRequestBody,
  encodeTelebirrAssignmentBrokerLocalPollRequest,
} from '@fetanagent/telebirr-verification-foundation';

import type { TelebirrDeviceBridgeDependencies } from './telebirr-device-bridge.js';

export type TelebirrAssignmentBrokerLocalExchange = (
  canonicalRequestBody: Uint8Array,
) => Promise<Uint8Array>;

function rawHeaderValues(response: IncomingMessage, expectedName: string): readonly string[] {
  const values: string[] = [];
  if (response.rawHeaders.length % 2 !== 0) return ['<invalid>'];
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    const name = response.rawHeaders[index];
    const value = response.rawHeaders[index + 1];
    if (name === undefined || value === undefined) return ['<invalid>'];
    if (name.toLowerCase() === expectedName) values.push(value);
  }
  return values;
}

function expectedResponseLength(response: IncomingMessage): number | undefined {
  const contentTypes = rawHeaderValues(response, 'content-type');
  const contentLengths = rawHeaderValues(response, 'content-length');
  const contentEncodings = rawHeaderValues(response, 'content-encoding');
  const transferEncodings = rawHeaderValues(response, 'transfer-encoding');
  if (
    response.statusCode !== 200 ||
    contentTypes.length !== 1 ||
    contentTypes[0] !== TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTENT_TYPE ||
    contentLengths.length !== 1 ||
    !/^[1-9][0-9]{0,4}$/u.test(contentLengths[0] ?? '') ||
    contentEncodings.length !== 0 ||
    transferEncodings.length !== 0
  ) {
    return undefined;
  }
  const parsed = Number(contentLengths[0]);
  return Number.isSafeInteger(parsed) &&
    parsed > 0 &&
    parsed <= TELEBIRR_ASSIGNMENT_BROKER_LOCAL_MAX_RESPONSE_BYTES
    ? parsed
    : undefined;
}

/** Sends one canonical poll over the one fixed Unix socket. It accepts no URL, host, or TCP port. */
export async function exchangeTelebirrAssignmentBrokerLocalRequest(
  canonicalRequestBody: Uint8Array,
): Promise<Uint8Array> {
  if (
    !(canonicalRequestBody instanceof Uint8Array) ||
    isProxy(canonicalRequestBody) ||
    canonicalRequestBody.byteLength === 0 ||
    canonicalRequestBody.byteLength > TELEBIRR_ASSIGNMENT_BROKER_LOCAL_MAX_REQUEST_BYTES
  ) {
    throw new Error('Local assignment broker unavailable');
  }
  const body = Buffer.from(canonicalRequestBody);
  return new Promise<Uint8Array>((resolvePromise, rejectPromise) => {
    let settled = false;
    const reject = (): void => {
      if (settled) return;
      settled = true;
      rejectPromise(new Error('Local assignment broker unavailable'));
    };
    const candidate = httpRequest(
      {
        agent: false,
        headers: {
          'content-length': String(body.byteLength),
          'content-type': TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTENT_TYPE,
        },
        method: 'POST',
        path: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_POLL_PATH,
        socketPath: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_SOCKET,
        timeout: 5_000,
      },
      (response) => {
        const expectedBytes = expectedResponseLength(response);
        if (expectedBytes === undefined) {
          response.resume();
          reject();
          return;
        }
        const chunks: Buffer[] = [];
        let receivedBytes = 0;
        response.on('data', (chunkValue: Buffer | string) => {
          if (settled) return;
          const chunk = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue);
          receivedBytes += chunk.byteLength;
          if (receivedBytes > expectedBytes) {
            response.destroy();
            reject();
          } else {
            chunks.push(chunk);
          }
        });
        response.once('end', () => {
          if (settled) return;
          if (receivedBytes !== expectedBytes) {
            reject();
            return;
          }
          settled = true;
          resolvePromise(Buffer.concat(chunks, receivedBytes));
        });
        response.once('aborted', reject);
        response.once('error', reject);
      },
    );
    candidate.once('timeout', () => {
      candidate.destroy();
      reject();
    });
    candidate.once('error', reject);
    candidate.end(body);
  });
}

/**
 * Adapts the authenticated bridge's exact assignment poll to the local broker wire contract.
 * Transport or decoding failures are always reduced to the bridge's non-sensitive retry outcome.
 */
export function createTelebirrAssignmentBrokerLocalPollAdapter(
  exchange: TelebirrAssignmentBrokerLocalExchange,
): TelebirrDeviceBridgeDependencies['pollAssignment'] {
  if (typeof exchange !== 'function') throw new Error('Local assignment broker unavailable');
  return async (certificate, requestCandidate, payload) => {
    try {
      const request = decodeSignedTelebirrDeviceBridgeRequest(requestCandidate);
      if (
        request === undefined ||
        request.body.command !== 'assignment_poll' ||
        request.body.canonicalPath !== TELEBIRR_DEVICE_BRIDGE_ASSIGNMENT_POLL_PATH ||
        request.body.enrollmentId !== certificate.enrollmentId ||
        request.body.deviceId !== certificate.deviceId ||
        request.body.keyId !== certificate.keyId ||
        digestTelebirrDeviceBridgeRequestBody(request.body) !== request.bodyDigest ||
        digestTelebirrDeviceBridgePayload('assignment_poll', payload) !== request.body.payloadDigest
      ) {
        return Object.freeze({ kind: 'retry' as const });
      }
      const canonicalRequest = encodeTelebirrAssignmentBrokerLocalPollRequest({
        contractVersion: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTRACT_VERSION,
        providerCode: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROVIDER_CODE,
        protocolMode: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROTOCOL_MODE,
        certificate,
        bridgeRequestBodyDigest: request.bodyDigest,
        requestedLeaseSeconds: payload.requestedLeaseSeconds,
        ...TELEBIRR_ASSIGNMENT_BROKER_LOCAL_NO_MONEY_SAFETY,
      });
      if (canonicalRequest === undefined) return Object.freeze({ kind: 'retry' as const });
      const decoded = decodeTelebirrAssignmentBrokerLocalPollResponseBytes(
        await exchange(canonicalRequest),
      );
      if (decoded?.outcome === 'assignment') {
        return Object.freeze({ kind: 'assignment' as const, assignment: decoded.assignment });
      }
      return Object.freeze({ kind: decoded?.outcome === 'no_assignment' ? 'none' : 'retry' });
    } catch {
      return Object.freeze({ kind: 'retry' as const });
    }
  };
}

export function createTelebirrAssignmentBrokerUnixPollAssignment(): TelebirrDeviceBridgeDependencies['pollAssignment'] {
  return createTelebirrAssignmentBrokerLocalPollAdapter(
    exchangeTelebirrAssignmentBrokerLocalRequest,
  );
}
