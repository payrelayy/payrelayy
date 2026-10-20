import { isProxy } from 'node:util/types';

import {
  RECEIVER_SMS_LOCAL_CONTENT_TYPE,
  RECEIVER_SMS_LOCAL_MAX_BYTES,
  RECEIVER_SMS_LOCAL_PATH,
} from '@fetanagent/telebirr-verification-foundation';

import type { createReceiverSmsIngestBroker } from './receiver-sms-ingest-broker.js';
import type {
  TelebirrAssignmentBrokerLocalHttpRequest,
  TelebirrAssignmentBrokerLocalHttpResponse,
} from './local-telebirr-assignment-broker-server.js';

type Broker = ReturnType<typeof createReceiverSmsIngestBroker>;

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== keys.length
  )
    return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
  });
}

function validEnvelope(request: TelebirrAssignmentBrokerLocalHttpRequest): boolean {
  if (
    request.method !== 'POST' ||
    request.path !== RECEIVER_SMS_LOCAL_PATH ||
    request.body.byteLength < 1 ||
    request.body.byteLength > RECEIVER_SMS_LOCAL_MAX_BYTES ||
    !Array.isArray(request.headers) ||
    isProxy(request.headers)
  )
    return false;
  const headers = new Map<string, string[]>();
  for (const entry of request.headers) {
    if (
      !Array.isArray(entry) ||
      isProxy(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== 'string' ||
      typeof entry[1] !== 'string'
    )
      return false;
    const name = entry[0].toLowerCase();
    headers.set(name, [...(headers.get(name) ?? []), entry[1]]);
  }
  return (
    headers.get('content-type')?.length === 1 &&
    headers.get('content-type')?.[0] === RECEIVER_SMS_LOCAL_CONTENT_TYPE &&
    headers.get('content-length')?.length === 1 &&
    headers.get('content-length')?.[0] === String(request.body.byteLength) &&
    !headers.has('content-encoding') &&
    !headers.has('transfer-encoding') &&
    !headers.has('expect')
  );
}

function response(statusCode: number, value: unknown): TelebirrAssignmentBrokerLocalHttpResponse {
  const body = Buffer.from(JSON.stringify(value));
  return Object.freeze({
    statusCode,
    headers: Object.freeze({
      'cache-control': 'no-store',
      'content-length': String(body.byteLength),
      'content-type': RECEIVER_SMS_LOCAL_CONTENT_TYPE,
      'x-content-type-options': 'nosniff',
    }),
    body,
  });
}

/** Accepts signed SMS envelopes only on the owner-checked private Unix socket. */
export function createReceiverSmsIngestLocalHandler(broker: Broker) {
  if (
    !broker ||
    typeof broker.loadEnrollment !== 'function' ||
    typeof broker.verifyAndRecord !== 'function'
  )
    throw new Error();
  return async (
    request: TelebirrAssignmentBrokerLocalHttpRequest,
  ): Promise<TelebirrAssignmentBrokerLocalHttpResponse> => {
    try {
      if (!validEnvelope(request)) return response(400, { code: 'invalid_request' });
      const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(request.body);
      if (!raw || raw.charCodeAt(0) === 0xfeff) return response(400, { code: 'invalid_request' });
      const value: unknown = JSON.parse(raw);
      if (
        JSON.stringify(value) !== raw ||
        !exact(value, ['operation', 'input']) ||
        typeof value.operation !== 'string'
      )
        return response(400, { code: 'invalid_request' });
      if (value.operation === 'load_enrollment') {
        if (!exact(value.input, ['deviceId']) || typeof value.input.deviceId !== 'string')
          return response(400, { code: 'invalid_request' });
        const enrollment = await broker.loadEnrollment(value.input.deviceId);
        return response(
          200,
          enrollment === undefined ? { kind: 'missing' } : { kind: 'enrollment', enrollment },
        );
      }
      if (value.operation === 'verify_and_record') {
        if (
          !exact(value.input, ['publicKeySpki', 'signedEvent']) ||
          typeof value.input.publicKeySpki !== 'string'
        )
          return response(400, { code: 'invalid_request' });
        const kind = await broker.verifyAndRecord({
          publicKeySpki: value.input.publicKeySpki,
          signedEvent: value.input.signedEvent,
        });
        return response(200, { kind });
      }
      return response(400, { code: 'invalid_request' });
    } catch {
      return response(503, { code: 'temporarily_unavailable' });
    }
  };
}
