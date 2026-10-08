import { isProxy } from 'node:util/types';

import {
  ROUTINE_NO_MONEY_LOCAL_CONTENT_TYPE,
  ROUTINE_NO_MONEY_LOCAL_MAX_BYTES,
  ROUTINE_NO_MONEY_LOCAL_PATH,
} from '@fetanagent/telebirr-verification-foundation';

import type { createRoutineNoMoneyBroker } from './routine-no-money-broker.js';
import type {
  TelebirrAssignmentBrokerLocalHttpRequest,
  TelebirrAssignmentBrokerLocalHttpResponse,
} from './local-telebirr-assignment-broker-server.js';

type Broker = ReturnType<typeof createRoutineNoMoneyBroker>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u;

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return false;
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === keys.length &&
    actual.every((key) => typeof key === 'string' && keys.includes(key))
  );
}

function canonicalUtc(value: unknown): value is string {
  if (typeof value !== 'string' || !UTC.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function parse(body: Uint8Array): unknown {
  try {
    const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(body);
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
    request.path !== ROUTINE_NO_MONEY_LOCAL_PATH ||
    !(request.body instanceof Uint8Array) ||
    isProxy(request.body) ||
    request.body.byteLength < 1 ||
    request.body.byteLength > ROUTINE_NO_MONEY_LOCAL_MAX_BYTES ||
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
    grouped.get('content-type')?.[0] === ROUTINE_NO_MONEY_LOCAL_CONTENT_TYPE &&
    grouped.get('content-length')?.length === 1 &&
    grouped.get('content-length')?.[0] === String(request.body.byteLength) &&
    !grouped.has('content-encoding') &&
    !grouped.has('transfer-encoding') &&
    !grouped.has('expect')
  );
}

function response(statusCode: number, value: unknown): TelebirrAssignmentBrokerLocalHttpResponse {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.byteLength > ROUTINE_NO_MONEY_LOCAL_MAX_BYTES) throw new Error();
  return Object.freeze({
    statusCode,
    headers: Object.freeze({
      'cache-control': 'no-store',
      connection: 'close',
      'content-length': String(body.byteLength),
      'content-type': ROUTINE_NO_MONEY_LOCAL_CONTENT_TYPE,
      'x-content-type-options': 'nosniff',
    }),
    body,
  });
}

function encodedContext(context: { readonly trustedSignerSpkiDer: Uint8Array }): unknown {
  const der = context.trustedSignerSpkiDer;
  if (!(der instanceof Uint8Array) || isProxy(der) || der.byteLength !== 91) throw new Error();
  return {
    ...context,
    trustedSignerSpkiDer: Buffer.from(der).toString('base64url'),
  };
}

/** No TCP listener or financial operation. The caller mounts this only on the owned 0600 socket. */
export function createRoutineNoMoneyLocalHandler(broker: Broker) {
  if (
    !broker ||
    typeof broker.loadEnrollment !== 'function' ||
    typeof broker.claimAndIssuePoll !== 'function' ||
    typeof broker.loadObservation !== 'function' ||
    typeof broker.stageObservationDigest !== 'function'
  )
    throw new Error();
  return async (
    request: TelebirrAssignmentBrokerLocalHttpRequest,
  ): Promise<TelebirrAssignmentBrokerLocalHttpResponse> => {
    try {
      if (!envelope(request)) return response(400, { code: 'invalid_request' });
      const value = parse(request.body);
      if (!exact(value, ['operation', 'input']) || typeof value.operation !== 'string') {
        return response(400, { code: 'invalid_request' });
      }
      const input = value.input;
      switch (value.operation) {
        case 'load_enrollment': {
          if (
            !exact(input, ['enrollmentId']) ||
            typeof input.enrollmentId !== 'string' ||
            !UUID.test(input.enrollmentId)
          )
            break;
          const result = await broker.loadEnrollment(input.enrollmentId);
          return response(
            200,
            result === undefined
              ? { kind: 'missing' }
              : { kind: 'enrollment', enrollment: result.enrollment },
          );
        }
        case 'claim_and_issue_poll': {
          if (
            !exact(input, ['enrollmentId', 'requestId', 'replayIdentity', 'requestExpiresAt']) ||
            typeof input.enrollmentId !== 'string' ||
            !UUID.test(input.enrollmentId) ||
            typeof input.requestId !== 'string' ||
            !UUID.test(input.requestId) ||
            typeof input.replayIdentity !== 'string' ||
            !DIGEST.test(input.replayIdentity) ||
            !canonicalUtc(input.requestExpiresAt)
          )
            break;
          const result = await broker.claimAndIssuePoll({
            enrollmentId: input.enrollmentId,
            requestId: input.requestId,
            replayIdentity: input.replayIdentity,
            requestExpiresAt: input.requestExpiresAt,
          });
          return response(
            200,
            result.kind === 'none'
              ? { kind: 'none' }
              : { kind: 'assignment', context: encodedContext(result.context) },
          );
        }
        case 'load_observation': {
          if (
            !exact(input, ['challengeId']) ||
            typeof input.challengeId !== 'string' ||
            !UUID.test(input.challengeId)
          )
            break;
          const context = await broker.loadObservation(input.challengeId);
          return response(
            200,
            context === undefined
              ? { kind: 'missing' }
              : { kind: 'observation', context: encodedContext(context) },
          );
        }
        case 'stage_observation_digest': {
          if (
            !exact(input, [
              'challengeId',
              'assignmentBodyDigest',
              'observationBodyDigest',
              'observationSignatureDigest',
              'replayIdentity',
            ]) ||
            typeof input.challengeId !== 'string' ||
            !UUID.test(input.challengeId) ||
            typeof input.assignmentBodyDigest !== 'string' ||
            !DIGEST.test(input.assignmentBodyDigest) ||
            typeof input.observationBodyDigest !== 'string' ||
            !DIGEST.test(input.observationBodyDigest) ||
            typeof input.observationSignatureDigest !== 'string' ||
            !DIGEST.test(input.observationSignatureDigest) ||
            typeof input.replayIdentity !== 'string' ||
            !DIGEST.test(input.replayIdentity)
          )
            break;
          const kind = await broker.stageObservationDigest({
            challengeId: input.challengeId,
            assignmentBodyDigest: input.assignmentBodyDigest,
            observationBodyDigest: input.observationBodyDigest,
            observationSignatureDigest: input.observationSignatureDigest,
            replayIdentity: input.replayIdentity,
          });
          return response(200, { kind });
        }
      }
      return response(400, { code: 'invalid_request' });
    } catch {
      return response(503, { code: 'temporarily_unavailable' });
    }
  };
}
