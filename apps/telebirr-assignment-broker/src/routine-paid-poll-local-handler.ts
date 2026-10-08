import { isProxy } from 'node:util/types';

import {
  ROUTINE_PAID_POLL_LOCAL_CONTENT_TYPE,
  ROUTINE_PAID_POLL_LOCAL_MAX_BYTES,
  ROUTINE_PAID_POLL_LOCAL_PATH,
} from '@fetanagent/telebirr-verification-foundation';

import type { createRoutinePaidPollBroker } from './routine-paid-poll-broker.js';
import type {
  TelebirrAssignmentBrokerLocalHttpRequest,
  TelebirrAssignmentBrokerLocalHttpResponse,
} from './local-telebirr-assignment-broker-server.js';

type Broker = ReturnType<typeof createRoutinePaidPollBroker>;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u;

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

function utc(value: unknown): value is string {
  if (typeof value !== 'string' || !UTC.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function parse(bytes: Uint8Array): unknown {
  try {
    const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    if (!raw || raw.charCodeAt(0) === 0xfeff) return undefined;
    const value: unknown = JSON.parse(raw);
    return JSON.stringify(value) === raw ? value : undefined;
  } catch {
    return undefined;
  }
}

function envelope(request: TelebirrAssignmentBrokerLocalHttpRequest): boolean {
  if (
    request.method !== 'POST' ||
    request.path !== ROUTINE_PAID_POLL_LOCAL_PATH ||
    !(request.body instanceof Uint8Array) ||
    isProxy(request.body) ||
    request.body.byteLength < 1 ||
    request.body.byteLength > ROUTINE_PAID_POLL_LOCAL_MAX_BYTES ||
    !Array.isArray(request.headers) ||
    isProxy(request.headers)
  )
    return false;
  const grouped = new Map<string, string[]>();
  for (const header of request.headers) {
    if (
      !Array.isArray(header) ||
      isProxy(header) ||
      header.length !== 2 ||
      typeof header[0] !== 'string' ||
      typeof header[1] !== 'string'
    )
      return false;
    const name = header[0].toLowerCase();
    grouped.set(name, [...(grouped.get(name) ?? []), header[1]]);
  }
  return (
    grouped.get('content-type')?.length === 1 &&
    grouped.get('content-type')?.[0] === ROUTINE_PAID_POLL_LOCAL_CONTENT_TYPE &&
    grouped.get('content-length')?.length === 1 &&
    grouped.get('content-length')?.[0] === String(request.body.byteLength) &&
    !grouped.has('content-encoding') &&
    !grouped.has('transfer-encoding') &&
    !grouped.has('expect')
  );
}

function response(statusCode: number, value: unknown): TelebirrAssignmentBrokerLocalHttpResponse {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.byteLength > ROUTINE_PAID_POLL_LOCAL_MAX_BYTES) throw new Error();
  return Object.freeze({
    statusCode,
    headers: Object.freeze({
      'cache-control': 'no-store',
      connection: 'close',
      'content-length': String(body.byteLength),
      'content-type': ROUTINE_PAID_POLL_LOCAL_CONTENT_TYPE,
      'x-content-type-options': 'nosniff',
    }),
    body,
  });
}

/** Unix-socket-only handler. It cannot load observations or execute deposits. */
export function createRoutinePaidPollLocalHandler(broker: Broker) {
  if (
    !broker ||
    typeof broker.loadEnrollment !== 'function' ||
    typeof broker.claimAndIssuePoll !== 'function'
  )
    throw new Error();
  return async (
    request: TelebirrAssignmentBrokerLocalHttpRequest,
  ): Promise<TelebirrAssignmentBrokerLocalHttpResponse> => {
    try {
      if (!envelope(request)) return response(400, { code: 'invalid_request' });
      const value = parse(request.body);
      if (!exact(value, ['operation', 'input']) || typeof value.operation !== 'string')
        return response(400, { code: 'invalid_request' });
      const input = value.input;
      if (value.operation === 'load_enrollment') {
        if (
          !exact(input, ['enrollmentId']) ||
          typeof input.enrollmentId !== 'string' ||
          !UUID_V4.test(input.enrollmentId)
        )
          return response(400, { code: 'invalid_request' });
        const loaded = await broker.loadEnrollment(input.enrollmentId);
        return response(
          200,
          loaded === undefined
            ? { kind: 'missing' }
            : { kind: 'enrollment', enrollment: loaded.enrollment },
        );
      }
      if (value.operation === 'claim_and_issue_poll') {
        if (
          !exact(input, ['enrollmentId', 'requestId', 'replayIdentity', 'requestExpiresAt']) ||
          typeof input.enrollmentId !== 'string' ||
          !UUID_V4.test(input.enrollmentId) ||
          typeof input.requestId !== 'string' ||
          !UUID_V4.test(input.requestId) ||
          typeof input.replayIdentity !== 'string' ||
          !DIGEST.test(input.replayIdentity) ||
          !utc(input.requestExpiresAt)
        )
          return response(400, { code: 'invalid_request' });
        const issued = await broker.claimAndIssuePoll({
          enrollmentId: input.enrollmentId,
          requestId: input.requestId,
          replayIdentity: input.replayIdentity,
          requestExpiresAt: input.requestExpiresAt,
        });
        if (issued.kind === 'none') return response(200, { kind: 'none' });
        const der = issued.context.trustedSignerSpkiDer;
        if (!(der instanceof Uint8Array) || isProxy(der) || der.byteLength !== 91)
          throw new Error();
        return response(200, {
          kind: 'assignment',
          context: {
            ...issued.context,
            trustedSignerSpkiDer: Buffer.from(der).toString('base64url'),
          },
        });
      }
      return response(400, { code: 'invalid_request' });
    } catch {
      return response(503, { code: 'temporarily_unavailable' });
    }
  };
}
