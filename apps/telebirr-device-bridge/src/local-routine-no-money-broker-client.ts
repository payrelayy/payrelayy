import { request as httpRequest, type IncomingMessage } from 'node:http';

import {
  ROUTINE_NO_MONEY_LOCAL_CONTENT_TYPE,
  ROUTINE_NO_MONEY_LOCAL_MAX_BYTES,
  ROUTINE_NO_MONEY_LOCAL_PATH,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_SOCKET,
} from '@fetanagent/telebirr-verification-foundation';

import type {
  RoutineNoMoneyAssignmentContext,
  RoutineNoMoneyBridgeDependencies,
  RoutineNoMoneyObservationContext,
} from './routine-no-money-bridge.js';

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
  if (body.byteLength < 1 || body.byteLength > ROUTINE_NO_MONEY_LOCAL_MAX_BYTES) throw new Error();
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
          'content-type': ROUTINE_NO_MONEY_LOCAL_CONTENT_TYPE,
        },
        method: 'POST',
        path: ROUTINE_NO_MONEY_LOCAL_PATH,
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
            contentType[0] !== ROUTINE_NO_MONEY_LOCAL_CONTENT_TYPE ||
            lengths.length !== 1 ||
            !/^[1-9][0-9]{0,4}$/u.test(lengths[0] ?? '') ||
            headerValues(response, 'content-encoding').length !== 0 ||
            headerValues(response, 'transfer-encoding').length !== 0
          )
            throw new Error();
          const expected = Number(lengths[0]);
          if (!Number.isSafeInteger(expected) || expected > ROUTINE_NO_MONEY_LOCAL_MAX_BYTES)
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

function context(
  value: unknown,
  withAssignment: boolean,
): RoutineNoMoneyAssignmentContext | RoutineNoMoneyObservationContext {
  const keys = withAssignment
    ? [
        'enrollmentId',
        'trustedLookup',
        'trustedRawReference',
        'trustedSigner',
        'deviceEnrollment',
        'trustedSignerSpkiDer',
        'signedAssignment',
      ]
    : [
        'enrollmentId',
        'trustedLookup',
        'trustedRawReference',
        'trustedSigner',
        'deviceEnrollment',
        'trustedSignerSpkiDer',
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
  return { ...value, trustedSignerSpkiDer: der } as unknown as RoutineNoMoneyAssignmentContext;
}

/** The public bridge receives no database password, private key, or reference-opening key. */
export function createRoutineNoMoneyLocalAdapter(
  wire: (operation: string, input: unknown) => Promise<unknown>,
  now: () => string,
): RoutineNoMoneyBridgeDependencies {
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
      input: Parameters<RoutineNoMoneyBridgeDependencies['claimAndIssuePoll']>[0],
    ) {
      const value = await wire('claim_and_issue_poll', input);
      if (exact(value, ['kind']) && value.kind === 'none') return { kind: 'none' as const };
      if (!exact(value, ['kind', 'context']) || value.kind !== 'assignment') throw new Error();
      return {
        kind: 'assignment' as const,
        context: context(value.context, true) as RoutineNoMoneyAssignmentContext,
      };
    },
    async loadObservation(challengeId: string) {
      const value = await wire('load_observation', { challengeId });
      if (exact(value, ['kind']) && value.kind === 'missing') return undefined;
      if (!exact(value, ['kind', 'context']) || value.kind !== 'observation') throw new Error();
      return context(value.context, false) as RoutineNoMoneyObservationContext;
    },
    async stageObservationDigest(
      input: Parameters<RoutineNoMoneyBridgeDependencies['stageObservationDigest']>[0],
    ) {
      const value = await wire('stage_observation_digest', input);
      if (
        !exact(value, ['kind']) ||
        (value.kind !== 'recorded' && value.kind !== 'exact_replay' && value.kind !== 'conflict')
      ) {
        throw new Error();
      }
      return value.kind;
    },
  });
}

export function createRoutineNoMoneyUnixDependencies(
  now: () => string = () => new Date().toISOString(),
): RoutineNoMoneyBridgeDependencies {
  return createRoutineNoMoneyLocalAdapter(exchange, now);
}
