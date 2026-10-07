import { createHash } from 'node:crypto';

import {
  assessRoutineTelebirrNoMoneyAssignment,
  assessRoutineTelebirrNoMoneyEvidence,
  verifyRoutineNoMoneyPollRequest,
} from '@fetanagent/telebirr-verification-foundation';

import type {
  TelebirrDeviceBridgeHttpRequest,
  TelebirrDeviceBridgeHttpResponse,
} from './telebirr-device-bridge.js';

export const ROUTINE_NO_MONEY_POLL_PATH = '/v1/telebirr/routine/assignments:poll' as const;
export const ROUTINE_NO_MONEY_UPLOAD_PATH = '/v1/telebirr/routine/observations:upload' as const;
export const ROUTINE_NO_MONEY_CONTENT_TYPE =
  'application/vnd.fetanagent.telebirr-routine-no-money.v1+json' as const;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const P1363 = /^[A-Za-z0-9_-]{86}$/u;
const MAX_POLL_BYTES = 4_096;
const MAX_UPLOAD_BYTES = 48 * 1_024;
const headers = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'content-type': ROUTINE_NO_MONEY_CONTENT_TYPE,
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
});

export interface RoutineNoMoneyAssignmentContext {
  readonly enrollmentId: string;
  readonly trustedLookup: unknown;
  readonly trustedRawReference: string;
  readonly trustedSigner: unknown;
  readonly deviceEnrollment: unknown;
  readonly trustedSignerSpkiDer: Uint8Array;
  readonly signedAssignment: unknown;
}

export interface RoutineNoMoneyObservationContext extends Omit<
  RoutineNoMoneyAssignmentContext,
  'signedAssignment'
> {}

export interface RoutineNoMoneyBridgeDependencies {
  readonly now: () => string;
  /** Must load an unrevoked enrollment independently of the caller's public-key hint. */
  loadEnrollment(enrollmentId: string): Promise<{ readonly enrollment: unknown } | undefined>;
  /** Must atomically check the no-money gate, replay ID, and candidate before issuing one lookup. */
  claimAndIssuePoll(input: {
    readonly enrollmentId: string;
    readonly requestId: string;
    readonly replayIdentity: string;
    readonly requestExpiresAt: string;
  }): Promise<
    | { readonly kind: 'none' }
    | { readonly kind: 'retry' }
    | { readonly kind: 'rejected' }
    | { readonly kind: 'assignment'; readonly context: RoutineNoMoneyAssignmentContext }
  >;
  /** Must load the exact candidate/challenge, signer, and enrollment in one protected snapshot. */
  loadObservation(challengeId: string): Promise<RoutineNoMoneyObservationContext | undefined>;
  /** Only digest-only, one-observation-per-challenge review storage; never a payment claim. */
  stageObservationDigest(input: {
    readonly challengeId: string;
    readonly assignmentBodyDigest: string;
    readonly observationBodyDigest: string;
    readonly observationSignatureDigest: string;
    readonly replayIdentity: string;
  }): Promise<'recorded' | 'exact_replay' | 'conflict' | 'retry'>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function own(value: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function hasKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === keys.length &&
    actual.every((key) => typeof key === 'string' && keys.includes(key)) &&
    keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
    })
  );
}

function canonicalUtc(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value))
    return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function parseCanonicalJson(bytes: Uint8Array): unknown {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    if (text.length === 0 || text.charCodeAt(0) === 0xfeff) return undefined;
    const value = JSON.parse(text) as unknown;
    // The fixed phone encoder emits compact JSON. The round-trip rejects duplicate keys,
    // ambiguous numeric spellings, BOMs, and whitespace rather than normalizing them.
    return JSON.stringify(value) === text ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Public key bytes are untrusted until their digest and signature match the enrollment. */
function publicKeyHint(value: unknown): Uint8Array | undefined {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{86,684}$/u.test(value)) return undefined;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.byteLength >= 64 && bytes.byteLength <= 512 && bytes.toString('base64url') === value
    ? bytes
    : undefined;
}

function validHttpRequest(request: TelebirrDeviceBridgeHttpRequest): boolean {
  if (
    request.method !== 'POST' ||
    ![ROUTINE_NO_MONEY_POLL_PATH, ROUTINE_NO_MONEY_UPLOAD_PATH].includes(
      request.path as typeof ROUTINE_NO_MONEY_POLL_PATH,
    ) ||
    !(request.body instanceof Uint8Array) ||
    request.body.byteLength === 0 ||
    request.body.byteLength >
      (request.path === ROUTINE_NO_MONEY_POLL_PATH ? MAX_POLL_BYTES : MAX_UPLOAD_BYTES) ||
    !Array.isArray(request.headers)
  )
    return false;
  let contentTypeCount = 0;
  for (const header of request.headers) {
    if (
      !Array.isArray(header) ||
      header.length !== 2 ||
      typeof header[0] !== 'string' ||
      typeof header[1] !== 'string'
    )
      return false;
    const name = header[0].toLowerCase();
    if (name === 'content-type') {
      contentTypeCount += 1;
      if (header[1] !== ROUTINE_NO_MONEY_CONTENT_TYPE) return false;
    }
    if (name === 'content-encoding' || name === 'transfer-encoding') return false;
  }
  return contentTypeCount === 1;
}

function response(statusCode: number, body: unknown): TelebirrDeviceBridgeHttpResponse {
  return Object.freeze({
    statusCode,
    headers,
    body: Buffer.from(JSON.stringify(body), 'utf8'),
  });
}

function error(statusCode: number, code: string): TelebirrDeviceBridgeHttpResponse {
  return response(statusCode, { code });
}

async function handlePoll(
  value: unknown,
  dependencies: RoutineNoMoneyBridgeDependencies,
): Promise<TelebirrDeviceBridgeHttpResponse> {
  if (!isRecord(value) || !hasKeys(value, ['publicKeySpki', 'signedRequest'])) {
    return error(400, 'invalid_request');
  }
  const publicKeySpkiDer = publicKeyHint(own(value, 'publicKeySpki'));
  const signedRequest = own(value, 'signedRequest');
  if (!publicKeySpkiDer) return error(400, 'invalid_request');
  const body = isRecord(signedRequest) && own(signedRequest, 'body');
  const enrollmentId = isRecord(body) && own(body, 'enrollmentId');
  if (typeof enrollmentId !== 'string' || !UUID_V4.test(enrollmentId)) {
    return error(400, 'invalid_request');
  }
  const loaded = await dependencies.loadEnrollment(enrollmentId);
  const assessedAt = dependencies.now();
  if (!loaded || !canonicalUtc(assessedAt)) return error(401, 'device_unavailable');
  const assessment = verifyRoutineNoMoneyPollRequest(
    signedRequest,
    loaded.enrollment,
    publicKeySpkiDer,
    assessedAt,
  );
  if (assessment.disposition !== 'would_consider_no_money_poll' || !assessment.replayIdentity) {
    return error(401, 'invalid_request');
  }
  const requestBody = body as Record<string, unknown>;
  const issued = await dependencies.claimAndIssuePoll({
    enrollmentId,
    requestId: requestBody.requestId as string,
    replayIdentity: assessment.replayIdentity,
    requestExpiresAt: requestBody.expiresAt as string,
  });
  if (issued.kind === 'none') {
    return response(200, {
      outcome: 'no_assignment',
      advisoryOnly: true,
      financialActionAllowed: false,
    });
  }
  if (issued.kind === 'retry') return error(503, 'temporarily_unavailable');
  if (issued.kind === 'rejected') return error(403, 'no_money_poll_stopped');
  const context = issued.context;
  const enrollment = loaded.enrollment;
  if (
    !isRecord(enrollment) ||
    !isRecord(context.deviceEnrollment) ||
    context.enrollmentId !== enrollmentId ||
    own(context.deviceEnrollment, 'deviceId') !== own(enrollment, 'deviceId') ||
    own(context.deviceEnrollment, 'keyId') !== own(enrollment, 'keyId') ||
    own(context.deviceEnrollment, 'publicKeySpkiSha256') !==
      own(enrollment, 'publicKeySpkiSha256') ||
    own(context.deviceEnrollment, 'receiverRevisionId') !== own(enrollment, 'receiverRevisionId') ||
    own(context.deviceEnrollment, 'receiverProfileDigest') !==
      own(enrollment, 'receiverProfileDigest')
  )
    return error(503, 'temporarily_unavailable');
  const assignmentAssessment = assessRoutineTelebirrNoMoneyAssignment(
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
  if (assignmentAssessment.disposition !== 'would_forward_signed_lookup') {
    return error(503, 'temporarily_unavailable');
  }
  return response(200, {
    outcome: 'assignment',
    advisoryOnly: true,
    financialActionAllowed: false,
    signedAssignment: context.signedAssignment,
  });
}

async function handleUpload(
  value: unknown,
  dependencies: RoutineNoMoneyBridgeDependencies,
): Promise<TelebirrDeviceBridgeHttpResponse> {
  if (
    !isRecord(value) ||
    !hasKeys(value, ['publicKeySpki', 'signedAssignment', 'signedObservation'])
  ) {
    return error(400, 'invalid_request');
  }
  const publicKeySpkiDer = publicKeyHint(own(value, 'publicKeySpki'));
  if (!publicKeySpkiDer) return error(400, 'invalid_request');
  const signedAssignment = own(value, 'signedAssignment');
  const signedObservation = own(value, 'signedObservation');
  const observationBody = isRecord(signedObservation) && own(signedObservation, 'body');
  const challengeId = isRecord(observationBody) && own(observationBody, 'challengeId');
  if (typeof challengeId !== 'string' || !UUID_V4.test(challengeId)) {
    return error(400, 'invalid_request');
  }
  const context = await dependencies.loadObservation(challengeId);
  const assessedAt = dependencies.now();
  if (!context || !canonicalUtc(assessedAt)) return error(401, 'observation_unavailable');
  const assessment = assessRoutineTelebirrNoMoneyEvidence(
    {
      assessedAt,
      trustedLookup: context.trustedLookup,
      trustedRawReference: context.trustedRawReference,
      trustedSigner: context.trustedSigner,
      deviceEnrollment: context.deviceEnrollment,
      signedAssignment,
      signedObservation,
    },
    context.trustedSignerSpkiDer,
    publicKeySpkiDer,
  );
  if (!assessment.deviceSignatureVerified || !assessment.providedSnapshotMatched) {
    return error(401, 'invalid_request');
  }
  if (assessment.disposition !== 'would_forward_signed_evidence' || !assessment.replayIdentity) {
    return response(202, {
      outcome: 'review',
      advisoryOnly: true,
      sourceAuthenticationPerformed: false,
      financialActionAllowed: false,
    });
  }
  if (!isRecord(signedAssignment) || !isRecord(signedObservation)) {
    return error(400, 'invalid_request');
  }
  const assignmentBodyDigest = own(signedAssignment, 'bodyDigest');
  const observationBodyDigest = own(signedObservation, 'bodyDigest');
  const signature = own(signedObservation, 'signature');
  if (
    typeof assignmentBodyDigest !== 'string' ||
    !DIGEST.test(assignmentBodyDigest) ||
    typeof observationBodyDigest !== 'string' ||
    !DIGEST.test(observationBodyDigest) ||
    typeof signature !== 'string' ||
    !P1363.test(signature)
  ) {
    return error(400, 'invalid_request');
  }
  const observationSignatureDigest = `sha256:${createHash('sha256')
    .update(Buffer.from(signature, 'base64url'))
    .digest('hex')}`;
  const staged = await dependencies.stageObservationDigest({
    challengeId,
    assignmentBodyDigest,
    observationBodyDigest,
    observationSignatureDigest,
    replayIdentity: assessment.replayIdentity,
  });
  if (staged === 'retry') return error(503, 'temporarily_unavailable');
  if (staged === 'conflict') return error(409, 'observation_conflict');
  return response(202, {
    outcome: 'signed_evidence_received_for_review',
    advisoryOnly: true,
    sourceAuthenticationPerformed: false,
    financialActionAllowed: false,
  });
}

/** Dormant route logic: not mounted by the operational bridge or granted a database role. */
export function createRoutineNoMoneyBridgeHandler(
  dependencies: RoutineNoMoneyBridgeDependencies,
): (request: TelebirrDeviceBridgeHttpRequest) => Promise<TelebirrDeviceBridgeHttpResponse> {
  return async (request) => {
    try {
      if (!validHttpRequest(request)) return error(400, 'invalid_request');
      const value = parseCanonicalJson(request.body);
      if (value === undefined) return error(400, 'invalid_request');
      return request.path === ROUTINE_NO_MONEY_POLL_PATH
        ? await handlePoll(value, dependencies)
        : await handleUpload(value, dependencies);
    } catch {
      return error(503, 'temporarily_unavailable');
    }
  };
}
