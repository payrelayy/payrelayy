import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';

import {
  assessRoutineTelebirrPaidPhoneEvidence,
  type RoutineTelebirrPaidPhoneEvidence,
} from '@fetanagent/telebirr-verification-foundation';

import type {
  TelebirrDeviceBridgeHttpRequest,
  TelebirrDeviceBridgeHttpResponse,
} from './telebirr-device-bridge.js';

export const ROUTINE_PAID_UPLOAD_PATH = '/v1/telebirr/routine/paid/observations:upload' as const;
export const ROUTINE_PAID_UPLOAD_CONTENT_TYPE =
  'application/vnd.fetanagent.telebirr-routine-paid-observation.v1+json' as const;
export const ROUTINE_PAID_UPLOAD_MAX_REQUEST_BYTES = 48 * 1_024;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
const headers = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'content-type': ROUTINE_PAID_UPLOAD_CONTENT_TYPE,
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
});

export interface RoutinePaidUploadObservationContext {
  readonly trustedLookup: unknown;
  readonly trustedRawReference: string;
  readonly trustedSigner: unknown;
  readonly deviceEnrollment: unknown;
  readonly trustedSignerSpkiDer: Uint8Array;
  /** Must come from the protected challenge row, never the phone request. */
  readonly trustedIssuanceMode: 'paid';
}

export interface RoutinePaidUploadBridgeDependencies {
  readonly now: () => string;
  loadObservation(challengeId: string): Promise<RoutinePaidUploadObservationContext | undefined>;
  stageObservation(input: {
    readonly evidence: RoutineTelebirrPaidPhoneEvidence;
    readonly assignmentBodyDigest: string;
    readonly observationSignatureDigest: string;
    readonly signedObservation: unknown;
  }): Promise<'recorded' | 'exact_replay' | 'conflict' | 'retry'>;
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

function parseCanonicalJson(bytes: Uint8Array): unknown {
  try {
    const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    if (!raw || raw.charCodeAt(0) === 0xfeff) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return JSON.stringify(parsed) === raw ? parsed : undefined;
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
    request.path !== ROUTINE_PAID_UPLOAD_PATH ||
    !(request.body instanceof Uint8Array) ||
    isProxy(request.body) ||
    request.body.byteLength < 1 ||
    request.body.byteLength > ROUTINE_PAID_UPLOAD_MAX_REQUEST_BYTES ||
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
      if (header[1] !== ROUTINE_PAID_UPLOAD_CONTENT_TYPE) return false;
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

/** Unmounted paid upload logic. Only a protected broker may supply its trusted snapshot. */
export function createRoutinePaidUploadBridgeHandler(
  dependencies: RoutinePaidUploadBridgeDependencies,
) {
  if (
    !dependencies ||
    typeof dependencies.now !== 'function' ||
    typeof dependencies.loadObservation !== 'function' ||
    typeof dependencies.stageObservation !== 'function'
  )
    throw new Error();
  return async (
    request: TelebirrDeviceBridgeHttpRequest,
  ): Promise<TelebirrDeviceBridgeHttpResponse> => {
    try {
      if (!validRequest(request)) return error(400, 'invalid_request');
      const value = parseCanonicalJson(request.body);
      if (!exact(value, ['publicKeySpki', 'signedAssignment', 'signedObservation']))
        return error(400, 'invalid_request');
      const deviceSpkiDer = publicKeyHint(own(value, 'publicKeySpki'));
      const signedAssignment = own(value, 'signedAssignment');
      const signedObservation = own(value, 'signedObservation');
      const body = record(signedObservation) && own(signedObservation, 'body');
      const challengeId = record(body) && own(body, 'challengeId');
      if (
        !deviceSpkiDer ||
        !record(signedAssignment) ||
        !record(signedObservation) ||
        typeof challengeId !== 'string' ||
        !UUID_V4.test(challengeId)
      )
        return error(400, 'invalid_request');
      const context = await dependencies.loadObservation(challengeId);
      if (!context) return error(401, 'observation_unavailable');
      const assessment = assessRoutineTelebirrPaidPhoneEvidence(
        {
          assessedAt: dependencies.now(),
          trustedLookup: context.trustedLookup,
          trustedRawReference: context.trustedRawReference,
          trustedSigner: context.trustedSigner,
          deviceEnrollment: context.deviceEnrollment,
          signedAssignment,
          signedObservation,
          trustedIssuanceMode: context.trustedIssuanceMode,
        },
        context.trustedSignerSpkiDer,
        deviceSpkiDer,
      );
      if (assessment.disposition !== 'paid_phone_observation_matches_policy')
        return error(403, 'paid_observation_review');
      const assignmentBodyDigest = own(signedAssignment, 'bodyDigest');
      const signature = own(signedObservation, 'signature');
      if (
        typeof assignmentBodyDigest !== 'string' ||
        !DIGEST.test(assignmentBodyDigest) ||
        typeof signature !== 'string' ||
        !SIGNATURE.test(signature)
      )
        return error(400, 'invalid_request');
      const observationSignatureDigest = `sha256:${createHash('sha256')
        .update(Buffer.from(signature, 'base64url'))
        .digest('hex')}`;
      const staged = await dependencies.stageObservation({
        evidence: assessment.evidence,
        assignmentBodyDigest,
        observationSignatureDigest,
        signedObservation,
      });
      if (staged === 'retry') return error(503, 'temporarily_unavailable');
      if (staged === 'conflict') return error(409, 'observation_conflict');
      if (staged !== 'recorded' && staged !== 'exact_replay')
        return error(503, 'temporarily_unavailable');
      return response(202, {
        outcome: 'signed_paid_observation_staged',
        advisoryOnly: true,
        paymentVerificationRequested: true,
        pairedPhoneEvidenceVerified: true,
        sourceAuthenticationPerformed: false,
        financialActionAllowed: false,
      });
    } catch {
      return error(503, 'temporarily_unavailable');
    }
  };
}
