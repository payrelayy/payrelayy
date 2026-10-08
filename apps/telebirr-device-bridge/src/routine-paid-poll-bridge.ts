import { isProxy } from 'node:util/types';

import {
  assessRoutineTelebirrNoMoneyAssignment,
  verifyRoutinePaidPollRequest,
} from '@fetanagent/telebirr-verification-foundation';

import type {
  TelebirrDeviceBridgeHttpRequest,
  TelebirrDeviceBridgeHttpResponse,
} from './telebirr-device-bridge.js';

export const ROUTINE_PAID_POLL_PATH = '/v1/telebirr/routine/paid/assignments:poll' as const;
export const ROUTINE_PAID_POLL_CONTENT_TYPE =
  'application/vnd.fetanagent.telebirr-routine-paid-poll.v1+json' as const;
export const ROUTINE_PAID_POLL_MAX_REQUEST_BYTES = 4_096 as const;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const headers = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'content-type': ROUTINE_PAID_POLL_CONTENT_TYPE,
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
});

export interface RoutinePaidPollAssignmentContext {
  readonly enrollmentId: string;
  readonly trustedLookup: unknown;
  readonly trustedRawReference: string;
  readonly trustedSigner: unknown;
  readonly deviceEnrollment: unknown;
  readonly trustedSignerSpkiDer: Uint8Array;
  readonly signedAssignment: unknown;
}

export interface RoutinePaidPollBridgeDependencies {
  readonly now: () => string;
  loadEnrollment(enrollmentId: string): Promise<{ readonly enrollment: unknown } | undefined>;
  /** The paid SQL role atomically claims this signed request and rechecks Owner/live gates. */
  claimAndIssuePoll(input: {
    readonly enrollmentId: string;
    readonly requestId: string;
    readonly replayIdentity: string;
    readonly requestExpiresAt: string;
  }): Promise<
    | { readonly kind: 'none' }
    | { readonly kind: 'retry' }
    | { readonly kind: 'rejected' }
    | { readonly kind: 'assignment'; readonly context: RoutinePaidPollAssignmentContext }
  >;
}

function record(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !isProxy(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!record(value) || Reflect.ownKeys(value).length !== keys.length) return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
  });
}

function own(value: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function utc(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value))
    return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function parseCanonicalJson(bytes: Uint8Array): unknown {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    if (!text || text.charCodeAt(0) === 0xfeff) return undefined;
    const value: unknown = JSON.parse(text);
    return JSON.stringify(value) === text ? value : undefined;
  } catch {
    return undefined;
  }
}

function publicKeyHint(value: unknown): Uint8Array | undefined {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{86,684}$/u.test(value)) return undefined;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.byteLength >= 64 && bytes.byteLength <= 512 && bytes.toString('base64url') === value
    ? bytes
    : undefined;
}

function validRequest(request: TelebirrDeviceBridgeHttpRequest): boolean {
  if (
    request.method !== 'POST' ||
    request.path !== ROUTINE_PAID_POLL_PATH ||
    !(request.body instanceof Uint8Array) ||
    isProxy(request.body) ||
    request.body.byteLength < 1 ||
    request.body.byteLength > ROUTINE_PAID_POLL_MAX_REQUEST_BYTES ||
    !Array.isArray(request.headers) ||
    isProxy(request.headers)
  )
    return false;
  let contentTypeCount = 0;
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
    if (name === 'content-type') {
      contentTypeCount += 1;
      if (header[1] !== ROUTINE_PAID_POLL_CONTENT_TYPE) return false;
    }
    if (name === 'content-encoding' || name === 'transfer-encoding') return false;
  }
  return contentTypeCount === 1;
}

function response(statusCode: number, value: unknown): TelebirrDeviceBridgeHttpResponse {
  return Object.freeze({ statusCode, headers, body: Buffer.from(JSON.stringify(value), 'utf8') });
}

function error(statusCode: number, code: string): TelebirrDeviceBridgeHttpResponse {
  return response(statusCode, { code });
}

/** Signed paid-work poll only. A result is never payment or credit authority. */
export function createRoutinePaidPollBridgeHandler(
  dependencies: RoutinePaidPollBridgeDependencies,
) {
  if (
    !dependencies ||
    typeof dependencies.now !== 'function' ||
    typeof dependencies.loadEnrollment !== 'function' ||
    typeof dependencies.claimAndIssuePoll !== 'function'
  )
    throw new Error();
  return async (
    request: TelebirrDeviceBridgeHttpRequest,
  ): Promise<TelebirrDeviceBridgeHttpResponse> => {
    try {
      if (!validRequest(request)) return error(400, 'invalid_request');
      const value = parseCanonicalJson(request.body);
      if (!exact(value, ['publicKeySpki', 'signedRequest'])) return error(400, 'invalid_request');
      const publicKeySpkiDer = publicKeyHint(own(value, 'publicKeySpki'));
      const signedRequest = own(value, 'signedRequest');
      if (!publicKeySpkiDer || !record(signedRequest)) return error(400, 'invalid_request');
      const signedBody = own(signedRequest, 'body');
      if (!record(signedBody)) return error(400, 'invalid_request');
      const enrollmentId = own(signedBody, 'enrollmentId');
      if (typeof enrollmentId !== 'string' || !UUID_V4.test(enrollmentId))
        return error(400, 'invalid_request');
      const loaded = await dependencies.loadEnrollment(enrollmentId);
      const assessedAt = dependencies.now();
      if (!loaded || !utc(assessedAt)) return error(401, 'device_unavailable');
      const assessment = verifyRoutinePaidPollRequest(
        signedRequest,
        loaded.enrollment,
        publicKeySpkiDer,
        assessedAt,
      );
      if (
        assessment.disposition !== 'signed_paid_poll_matches_enrollment' ||
        !assessment.replayIdentity
      )
        return error(401, 'invalid_request');
      const issued = await dependencies.claimAndIssuePoll({
        enrollmentId,
        requestId: own(signedBody, 'requestId') as string,
        replayIdentity: assessment.replayIdentity,
        requestExpiresAt: own(signedBody, 'expiresAt') as string,
      });
      if (issued.kind === 'none')
        return response(200, {
          outcome: 'no_assignment',
          advisoryOnly: true,
          paymentVerificationRequested: true,
          financialActionAllowed: false,
        });
      if (issued.kind === 'retry') return error(503, 'temporarily_unavailable');
      if (issued.kind === 'rejected') return error(403, 'paid_poll_stopped');
      const context = issued.context;
      const enrollment = loaded.enrollment;
      if (
        !record(enrollment) ||
        !record(context.deviceEnrollment) ||
        context.enrollmentId !== enrollmentId ||
        own(context.deviceEnrollment, 'deviceId') !== own(enrollment, 'deviceId') ||
        own(context.deviceEnrollment, 'keyId') !== own(enrollment, 'keyId') ||
        own(context.deviceEnrollment, 'publicKeySpkiSha256') !==
          own(enrollment, 'publicKeySpkiSha256') ||
        own(context.deviceEnrollment, 'receiverRevisionId') !==
          own(enrollment, 'receiverRevisionId') ||
        own(context.deviceEnrollment, 'receiverProfileDigest') !==
          own(enrollment, 'receiverProfileDigest')
      )
        return error(503, 'temporarily_unavailable');
      const assignment = assessRoutineTelebirrNoMoneyAssignment(
        {
          assessedAt: dependencies.now(),
          trustedLookup: context.trustedLookup,
          trustedRawReference: context.trustedRawReference,
          trustedSigner: context.trustedSigner,
          deviceEnrollment: context.deviceEnrollment,
          signedAssignment: context.signedAssignment,
        },
        context.trustedSignerSpkiDer,
        publicKeySpkiDer,
      );
      if (assignment.disposition !== 'would_forward_signed_lookup')
        return error(503, 'temporarily_unavailable');
      return response(200, {
        outcome: 'assignment',
        advisoryOnly: true,
        paymentVerificationRequested: true,
        financialActionAllowed: false,
        signedAssignment: context.signedAssignment,
      });
    } catch {
      return error(503, 'temporarily_unavailable');
    }
  };
}
