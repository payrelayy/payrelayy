import { request as httpRequest, type IncomingMessage } from 'node:http';

import {
  ROUTINE_PAID_POLL_LOCAL_CONTENT_TYPE,
  ROUTINE_PAID_POLL_LOCAL_MAX_BYTES,
  ROUTINE_PAID_POLL_LOCAL_PATH,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_SOCKET,
} from '@fetanagent/telebirr-verification-foundation';

import type {
  RoutinePaidPollAssignmentContext,
  RoutinePaidPollBridgeDependencies,
} from './routine-paid-poll-bridge.js';
import type { RoutinePaidUploadBridgeDependencies } from './routine-paid-upload-bridge.js';

function record(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    record(value) &&
    Reflect.ownKeys(value).length === keys.length &&
    Reflect.ownKeys(value).every((key) => typeof key === 'string' && keys.includes(key))
  );
}

function headerValues(response: IncomingMessage, wanted: string): string[] {
  if (response.rawHeaders.length % 2 !== 0) throw new Error();
  const values: string[] = [];
  for (let i = 0; i < response.rawHeaders.length; i += 2) {
    if (response.rawHeaders[i]?.toLowerCase() === wanted) {
      values.push(response.rawHeaders[i + 1] ?? '');
    }
  }
  return values;
}

async function exchange(operation: string, input: unknown): Promise<unknown> {
  const body = Buffer.from(JSON.stringify({ operation, input }), 'utf8');
  if (body.byteLength < 1 || body.byteLength > ROUTINE_PAID_POLL_LOCAL_MAX_BYTES) throw new Error();
  return new Promise<unknown>((resolvePromise, rejectPromise) => {
    let settled = false;
    const fail = () => {
      if (!settled) {
        settled = true;
        rejectPromise(new Error('Private routine broker unavailable'));
      }
    };
    const request = httpRequest(
      {
        agent: false,
        headers: {
          'content-length': String(body.byteLength),
          'content-type': ROUTINE_PAID_POLL_LOCAL_CONTENT_TYPE,
        },
        method: 'POST',
        path: ROUTINE_PAID_POLL_LOCAL_PATH,
        socketPath: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_SOCKET,
        timeout: 5_000,
      },
      (response) => {
        try {
          const contentType = headerValues(response, 'content-type');
          const lengths = headerValues(response, 'content-length');
          if (
            response.statusCode !== 200 ||
            contentType.length !== 1 ||
            contentType[0] !== ROUTINE_PAID_POLL_LOCAL_CONTENT_TYPE ||
            lengths.length !== 1 ||
            !/^[1-9][0-9]{0,4}$/u.test(lengths[0] ?? '') ||
            headerValues(response, 'content-encoding').length !== 0 ||
            headerValues(response, 'transfer-encoding').length !== 0
          )
            throw new Error();
          const expected = Number(lengths[0]);
          if (!Number.isSafeInteger(expected) || expected > ROUTINE_PAID_POLL_LOCAL_MAX_BYTES)
            throw new Error();
          const chunks: Buffer[] = [];
          let received = 0;
          response.on('data', (chunkValue: Buffer | string) => {
            if (settled) return;
            const chunk = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue);
            received += chunk.byteLength;
            if (received > expected) {
              response.destroy();
              fail();
            } else chunks.push(chunk);
          });
          response.once('end', () => {
            if (settled || received !== expected) return fail();
            try {
              const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
                Buffer.concat(chunks, received),
              );
              if (!text || text.charCodeAt(0) === 0xfeff) return fail();
              const value: unknown = JSON.parse(text);
              if (JSON.stringify(value) !== text) return fail();
              settled = true;
              resolvePromise(value);
            } catch {
              fail();
            }
          });
          response.once('aborted', fail);
          response.once('error', fail);
        } catch {
          response.resume();
          fail();
        }
      },
    );
    request.once('timeout', () => {
      request.destroy();
      fail();
    });
    request.once('error', fail);
    request.end(body);
  });
}

function context(value: unknown): RoutinePaidPollAssignmentContext {
  const keys = [
    'enrollmentId',
    'trustedLookup',
    'trustedRawReference',
    'trustedSigner',
    'deviceEnrollment',
    'trustedSignerSpkiDer',
    'signedAssignment',
  ];
  if (
    !exact(value, keys) ||
    typeof value.enrollmentId !== 'string' ||
    typeof value.trustedRawReference !== 'string' ||
    typeof value.trustedSignerSpkiDer !== 'string' ||
    !/^[A-Za-z0-9_-]{122}$/u.test(value.trustedSignerSpkiDer)
  )
    throw new Error();
  const der = Buffer.from(value.trustedSignerSpkiDer, 'base64url');
  if (der.byteLength !== 91 || der.toString('base64url') !== value.trustedSignerSpkiDer)
    throw new Error();
  return { ...value, trustedSignerSpkiDer: der } as unknown as RoutinePaidPollAssignmentContext;
}

/** The public bridge has no paid database password, signer private key, or opening key. */
export function createRoutinePaidPollLocalAdapter(
  wire: (operation: string, input: unknown) => Promise<unknown>,
  now: () => string,
): RoutinePaidPollBridgeDependencies {
  if (typeof wire !== 'function' || typeof now !== 'function') throw new Error();
  return Object.freeze({
    now,
    async loadEnrollment(enrollmentId: string) {
      const value = await wire('load_enrollment', { enrollmentId });
      if (exact(value, ['kind']) && value.kind === 'missing') return undefined;
      if (!exact(value, ['kind', 'enrollment']) || value.kind !== 'enrollment') throw new Error();
      return { enrollment: value.enrollment };
    },
    async claimAndIssuePoll(
      input: Parameters<RoutinePaidPollBridgeDependencies['claimAndIssuePoll']>[0],
    ) {
      const value = await wire('claim_and_issue_poll', input);
      if (exact(value, ['kind']) && value.kind === 'none') return { kind: 'none' as const };
      if (!exact(value, ['kind', 'context']) || value.kind !== 'assignment') throw new Error();
      return { kind: 'assignment' as const, context: context(value.context) };
    },
  });
}

export function createRoutinePaidPollUnixDependencies(
  now: () => string = () => new Date().toISOString(),
): RoutinePaidPollBridgeDependencies {
  return createRoutinePaidPollLocalAdapter(exchange, now);
}

/** Reuses the broker's private Unix socket; the public bridge never opens the reference itself. */
export function createRoutinePaidUploadLocalAdapter(
  wire: (operation: string, input: unknown) => Promise<unknown>,
  now: () => string,
): RoutinePaidUploadBridgeDependencies {
  if (typeof wire !== 'function' || typeof now !== 'function') throw new Error();
  return Object.freeze({
    now,
    async loadObservation(challengeId: string) {
      const value = await wire('load_observation', { challengeId });
      if (exact(value, ['kind']) && value.kind === 'missing') return undefined;
      if (!exact(value, ['kind', 'context']) || value.kind !== 'observation_context')
        throw new Error();
      const contextValue = value.context;
      if (
        !exact(contextValue, [
          'enrollmentId',
          'trustedLookup',
          'trustedRawReference',
          'trustedSigner',
          'deviceEnrollment',
          'trustedSignerSpkiDer',
          'trustedIssuanceMode',
        ]) ||
        contextValue.trustedIssuanceMode !== 'paid' ||
        typeof contextValue.trustedRawReference !== 'string' ||
        typeof contextValue.trustedSignerSpkiDer !== 'string' ||
        !/^[A-Za-z0-9_-]{122}$/u.test(contextValue.trustedSignerSpkiDer)
      )
        throw new Error();
      const der = Buffer.from(contextValue.trustedSignerSpkiDer, 'base64url');
      if (der.byteLength !== 91 || der.toString('base64url') !== contextValue.trustedSignerSpkiDer)
        throw new Error();
      return {
        trustedLookup: contextValue.trustedLookup,
        trustedRawReference: contextValue.trustedRawReference,
        trustedSigner: contextValue.trustedSigner,
        deviceEnrollment: contextValue.deviceEnrollment,
        trustedSignerSpkiDer: der,
        trustedIssuanceMode: 'paid' as const,
      };
    },
    async stageObservation(
      input: Parameters<RoutinePaidUploadBridgeDependencies['stageObservation']>[0],
    ) {
      const value = await wire('stage_observation', input);
      if (
        !exact(value, ['kind']) ||
        (value.kind !== 'recorded' && value.kind !== 'exact_replay' && value.kind !== 'conflict')
      )
        throw new Error();
      return value.kind;
    },
  });
}

export function createRoutinePaidUploadUnixDependencies(
  now: () => string = () => new Date().toISOString(),
): RoutinePaidUploadBridgeDependencies {
  return createRoutinePaidUploadLocalAdapter(exchange, now);
}
