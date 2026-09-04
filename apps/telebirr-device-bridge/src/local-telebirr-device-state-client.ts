import { request as httpRequest, type IncomingMessage } from 'node:http';
import { isProxy } from 'node:util/types';

import {
  TELEBIRR_DEVICE_STATE_LOCAL_CONTENT_TYPE,
  TELEBIRR_DEVICE_STATE_LOCAL_CONTRACT_VERSION,
  TELEBIRR_DEVICE_STATE_LOCAL_MAX_REQUEST_BYTES,
  TELEBIRR_DEVICE_STATE_LOCAL_MAX_RESPONSE_BYTES,
  TELEBIRR_DEVICE_STATE_LOCAL_NO_MONEY_SAFETY,
  TELEBIRR_DEVICE_STATE_LOCAL_PATHS,
  TELEBIRR_DEVICE_STATE_LOCAL_PROTOCOL_MODE,
  TELEBIRR_DEVICE_STATE_LOCAL_PROVIDER_CODE,
  TELEBIRR_DEVICE_STATE_LOCAL_SOCKET,
  decodeTelebirrDeviceStateLocalResponseBytes,
  encodeTelebirrDeviceStateLocalRequest,
  telebirrDeviceStateLocalPathForOperation,
  type TelebirrDeviceStateLocalOperation,
  type TelebirrDeviceStateLocalPath,
  type TelebirrDeviceStateLocalRequest,
  type TelebirrDeviceStateLocalResponse,
} from '@fetanagent/telebirr-verification-foundation';

import type { TelebirrDeviceBridgeDependencies } from './telebirr-device-bridge.js';

export type TelebirrDeviceStateBridgeDependencies = Pick<
  TelebirrDeviceBridgeDependencies,
  | 'claimPairingChallenge'
  | 'completePairingChallenge'
  | 'releasePairingChallenge'
  | 'loadEnrollment'
  | 'claimReplay'
  | 'completeReplay'
  | 'releaseReplay'
  | 'recordHeartbeat'
  | 'stageEvidenceOnly'
>;

export type TelebirrDeviceStateLocalExchange = (
  path: TelebirrDeviceStateLocalPath,
  canonicalRequestBody: Uint8Array,
) => Promise<Uint8Array>;

export class TelebirrDeviceStateLocalClientError extends Error {
  constructor() {
    super('The local TeleBirr device-state service is unavailable.');
    this.name = 'TelebirrDeviceStateLocalClientError';
  }
}

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
    contentTypes[0] !== TELEBIRR_DEVICE_STATE_LOCAL_CONTENT_TYPE ||
    contentLengths.length !== 1 ||
    !/^[1-9][0-9]{0,5}$/u.test(contentLengths[0] ?? '') ||
    contentEncodings.length !== 0 ||
    transferEncodings.length !== 0
  ) {
    return undefined;
  }
  const parsed = Number(contentLengths[0]);
  return Number.isSafeInteger(parsed) &&
    parsed > 0 &&
    parsed <= TELEBIRR_DEVICE_STATE_LOCAL_MAX_RESPONSE_BYTES
    ? parsed
    : undefined;
}

/**
 * Sends one canonical operation over one fixed Unix socket. It accepts only a closed protocol path
 * union and accepts no URL, host, TCP port, credential, or database configuration.
 */
export async function exchangeTelebirrDeviceStateLocalRequest(
  path: TelebirrDeviceStateLocalPath,
  canonicalRequestBody: Uint8Array,
): Promise<Uint8Array> {
  if (
    !Object.values(TELEBIRR_DEVICE_STATE_LOCAL_PATHS).some((candidate) => candidate === path) ||
    !(canonicalRequestBody instanceof Uint8Array) ||
    isProxy(canonicalRequestBody) ||
    canonicalRequestBody.byteLength === 0 ||
    canonicalRequestBody.byteLength > TELEBIRR_DEVICE_STATE_LOCAL_MAX_REQUEST_BYTES
  ) {
    throw new TelebirrDeviceStateLocalClientError();
  }
  const body = Buffer.from(canonicalRequestBody);
  return new Promise<Uint8Array>((resolvePromise, rejectPromise) => {
    let settled = false;
    const reject = (): void => {
      if (settled) return;
      settled = true;
      rejectPromise(new TelebirrDeviceStateLocalClientError());
    };
    const candidate = httpRequest(
      {
        agent: false,
        headers: {
          'content-length': String(body.byteLength),
          'content-type': TELEBIRR_DEVICE_STATE_LOCAL_CONTENT_TYPE,
        },
        method: 'POST',
        path,
        socketPath: TELEBIRR_DEVICE_STATE_LOCAL_SOCKET,
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

function localHeader<T extends TelebirrDeviceStateLocalOperation>(operation: T) {
  return {
    contractVersion: TELEBIRR_DEVICE_STATE_LOCAL_CONTRACT_VERSION,
    providerCode: TELEBIRR_DEVICE_STATE_LOCAL_PROVIDER_CODE,
    protocolMode: TELEBIRR_DEVICE_STATE_LOCAL_PROTOCOL_MODE,
    operation,
    ...TELEBIRR_DEVICE_STATE_LOCAL_NO_MONEY_SAFETY,
  } as const;
}

async function exchangeOperation(
  exchange: TelebirrDeviceStateLocalExchange,
  request: TelebirrDeviceStateLocalRequest,
): Promise<TelebirrDeviceStateLocalResponse> {
  try {
    const body = encodeTelebirrDeviceStateLocalRequest(request);
    const path = telebirrDeviceStateLocalPathForOperation(request.operation);
    if (body === undefined || path === undefined) throw new Error();
    const response = decodeTelebirrDeviceStateLocalResponseBytes(await exchange(path, body));
    if (response === undefined || response.operation !== request.operation) {
      throw new Error();
    }
    return response;
  } catch {
    throw new TelebirrDeviceStateLocalClientError();
  }
}

export function createTelebirrDeviceStateLocalAdapter(
  exchange: TelebirrDeviceStateLocalExchange,
): TelebirrDeviceStateBridgeDependencies {
  if (typeof exchange !== 'function') throw new TelebirrDeviceStateLocalClientError();
  return Object.freeze({
    async claimPairingChallenge(pairingRequest, assessedAt) {
      const response = await exchangeOperation(exchange, {
        ...localHeader('pairing_claim'),
        pairingRequest,
        assessedAt,
      });
      if (response.operation !== 'pairing_claim') {
        throw new TelebirrDeviceStateLocalClientError();
      }
      if (response.outcome === 'missing') return undefined;
      if (response.outcome === 'in_progress') {
        return Object.freeze({ kind: 'in_progress' as const });
      }
      if (response.outcome === 'claimed' && response.certificateBody) {
        return Object.freeze({
          kind: 'claimed' as const,
          certificateBody: response.certificateBody,
        });
      }
      if (response.outcome === 'completed' && response.certificate) {
        return Object.freeze({
          kind: 'completed' as const,
          certificate: response.certificate,
        });
      }
      throw new TelebirrDeviceStateLocalClientError();
    },
    async completePairingChallenge(pairingRequestBodyDigest, certificate) {
      const response = await exchangeOperation(exchange, {
        ...localHeader('pairing_complete'),
        pairingRequestBodyDigest,
        certificate,
      });
      if (response.operation !== 'pairing_complete') {
        throw new TelebirrDeviceStateLocalClientError();
      }
      return response.completed;
    },
    async releasePairingChallenge(pairingRequestBodyDigest) {
      const response = await exchangeOperation(exchange, {
        ...localHeader('pairing_release'),
        pairingRequestBodyDigest,
      });
      if (response.operation !== 'pairing_release' || response.released !== true) {
        throw new TelebirrDeviceStateLocalClientError();
      }
    },
    async loadEnrollment(enrollmentId) {
      const response = await exchangeOperation(exchange, {
        ...localHeader('enrollment_load'),
        enrollmentId,
      });
      if (response.operation !== 'enrollment_load') {
        throw new TelebirrDeviceStateLocalClientError();
      }
      return response.certificate ?? undefined;
    },
    async claimReplay(replayIdentity, requestExpiresAt) {
      const response = await exchangeOperation(exchange, {
        ...localHeader('replay_claim'),
        replayIdentity,
        requestExpiresAt,
      });
      if (response.operation !== 'replay_claim') {
        throw new TelebirrDeviceStateLocalClientError();
      }
      if (response.outcome === 'completed' && response.response) {
        return Object.freeze({
          kind: 'completed' as const,
          response: response.response,
        });
      }
      if (response.outcome === 'claimed') {
        return Object.freeze({ kind: 'claimed' as const });
      }
      if (response.outcome === 'in_progress') {
        return Object.freeze({ kind: 'in_progress' as const });
      }
      throw new TelebirrDeviceStateLocalClientError();
    },
    async completeReplay(replayIdentity, response, requestExpiresAt) {
      const result = await exchangeOperation(exchange, {
        ...localHeader('replay_complete'),
        replayIdentity,
        response,
        requestExpiresAt,
      });
      if (result.operation !== 'replay_complete') {
        throw new TelebirrDeviceStateLocalClientError();
      }
      return result.completed;
    },
    async releaseReplay(replayIdentity) {
      const response = await exchangeOperation(exchange, {
        ...localHeader('replay_release'),
        replayIdentity,
      });
      if (response.operation !== 'replay_release' || response.released !== true) {
        throw new TelebirrDeviceStateLocalClientError();
      }
    },
    async recordHeartbeat(certificate, request, payload) {
      const response = await exchangeOperation(exchange, {
        ...localHeader('heartbeat_record'),
        certificate,
        request,
        payload,
      });
      if (response.operation !== 'heartbeat_record') {
        throw new TelebirrDeviceStateLocalClientError();
      }
      if (response.outcome === 'rejected' && response.reason) {
        return Object.freeze({ kind: 'rejected' as const, reason: response.reason });
      }
      if (response.outcome === 'accepted') {
        return Object.freeze({ kind: 'accepted' as const });
      }
      if (response.outcome === 'retry') {
        return Object.freeze({ kind: 'retry' as const });
      }
      throw new TelebirrDeviceStateLocalClientError();
    },
    async stageEvidenceOnly(certificate, request, payload) {
      const response = await exchangeOperation(exchange, {
        ...localHeader('evidence_stage'),
        certificate,
        request,
        payload,
      });
      if (response.operation !== 'evidence_stage') {
        throw new TelebirrDeviceStateLocalClientError();
      }
      if (response.outcome === 'rejected' && response.reason) {
        return Object.freeze({ kind: 'rejected' as const, reason: response.reason });
      }
      if (response.outcome === 'accepted') {
        return Object.freeze({ kind: 'accepted' as const });
      }
      if (response.outcome === 'retry') {
        return Object.freeze({ kind: 'retry' as const });
      }
      throw new TelebirrDeviceStateLocalClientError();
    },
  });
}

export function createTelebirrDeviceStateUnixDependencies(): TelebirrDeviceStateBridgeDependencies {
  return createTelebirrDeviceStateLocalAdapter(exchangeTelebirrDeviceStateLocalRequest);
}
