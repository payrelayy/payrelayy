import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { TextDecoder } from 'node:util';

import {
  TELEBIRR_DEVICE_BRIDGE_ASSIGNMENT_POLL_PATH,
  TELEBIRR_DEVICE_BRIDGE_CONTENT_TYPE,
  TELEBIRR_DEVICE_BRIDGE_HEARTBEAT_PATH,
  TELEBIRR_DEVICE_BRIDGE_OBSERVATION_UPLOAD_PATH,
  TELEBIRR_DEVICE_BRIDGE_PAIRING_PATH,
} from '@fetanagent/telebirr-verification-foundation';

import type {
  TelebirrDeviceBridgeHttpRequest,
  TelebirrDeviceBridgeHttpResponse,
} from './telebirr-device-bridge.js';
import {
  ROUTINE_NO_MONEY_CONTENT_TYPE,
  ROUTINE_NO_MONEY_POLL_PATH,
  ROUTINE_NO_MONEY_UPLOAD_PATH,
} from './routine-no-money-bridge.js';
import {
  ROUTINE_PAID_POLL_CONTENT_TYPE,
  ROUTINE_PAID_POLL_MAX_REQUEST_BYTES,
  ROUTINE_PAID_POLL_PATH,
} from './routine-paid-poll-bridge.js';
import {
  ROUTINE_PAID_UPLOAD_CONTENT_TYPE,
  ROUTINE_PAID_UPLOAD_MAX_REQUEST_BYTES,
  ROUTINE_PAID_UPLOAD_PATH,
} from './routine-paid-upload-bridge.js';

export const TELEBIRR_DEVICE_BRIDGE_LISTEN_HOST = '0.0.0.0' as const;
export const TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT = 8084 as const;
export const TELEBIRR_DEVICE_BRIDGE_MAX_REQUEST_BYTES = 256 * 1_024;
export const TELEBIRR_DEVICE_BRIDGE_MAX_RESPONSE_BYTES = 512 * 1_024;

const paths = new Set<string>([
  TELEBIRR_DEVICE_BRIDGE_PAIRING_PATH,
  TELEBIRR_DEVICE_BRIDGE_ASSIGNMENT_POLL_PATH,
  TELEBIRR_DEVICE_BRIDGE_HEARTBEAT_PATH,
  TELEBIRR_DEVICE_BRIDGE_OBSERVATION_UPLOAD_PATH,
]);
const routineRequestLimits = new Map<string, number>([
  [ROUTINE_NO_MONEY_POLL_PATH, 4_096],
  [ROUTINE_NO_MONEY_UPLOAD_PATH, 48 * 1_024],
]);
const ROUTINE_MAX_RESPONSE_BYTES = 16 * 1_024;
const routineStatuses = new Set([200, 202, 400, 401, 403, 409, 503]);
const routineErrorCodes = new Set([
  'invalid_request',
  'device_unavailable',
  'observation_unavailable',
  'no_money_poll_stopped',
  'paid_poll_stopped',
  'observation_conflict',
  'paid_observation_review',
  'temporarily_unavailable',
]);

const errorHeaders = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'content-type': 'application/json; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
});

export type TelebirrDeviceBridgeHandler = (
  request: TelebirrDeviceBridgeHttpRequest,
) => Promise<TelebirrDeviceBridgeHttpResponse>;

export interface TelebirrDeviceBridgeHttpServerRuntime {
  readonly server: Pick<Server, 'listening'>;
  readonly listen: () => Promise<void>;
  readonly ready: () => boolean;
  readonly close: () => Promise<void>;
}

export class TelebirrDeviceBridgeHttpServerError extends Error {
  constructor() {
    super('The TeleBirr device bridge HTTP server is unavailable.');
    this.name = 'TelebirrDeviceBridgeHttpServerError';
  }
}

function headerValues(
  headers: readonly (readonly [string, string])[],
  expectedName: string,
): readonly string[] | undefined {
  if (!Array.isArray(headers)) return undefined;
  const result: string[] = [];
  for (const candidate of headers) {
    if (
      !Array.isArray(candidate) ||
      candidate.length !== 2 ||
      typeof candidate[0] !== 'string' ||
      typeof candidate[1] !== 'string'
    ) {
      return undefined;
    }
    if (candidate[0].toLowerCase() === expectedName) result.push(candidate[1]);
  }
  return result;
}

function rawHeaders(request: IncomingMessage): readonly (readonly [string, string])[] | undefined {
  if (request.rawHeaders.length % 2 !== 0) return undefined;
  const result: (readonly [string, string])[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index];
    const value = request.rawHeaders[index + 1];
    if (name === undefined || value === undefined) return undefined;
    result.push(Object.freeze([name, value] as const));
  }
  return Object.freeze(result);
}

function declaredBodyLength(
  method: string | undefined,
  path: string | undefined,
  headers: readonly (readonly [string, string])[],
  routineAvailable: boolean,
  paidPollAvailable: boolean,
  paidUploadAvailable: boolean,
): number | undefined {
  const contentTypes = headerValues(headers, 'content-type');
  const contentLengths = headerValues(headers, 'content-length');
  const contentEncodings = headerValues(headers, 'content-encoding');
  const transferEncodings = headerValues(headers, 'transfer-encoding');
  const expects = headerValues(headers, 'expect');
  const routineLimit =
    routineAvailable && path !== undefined ? routineRequestLimits.get(path) : undefined;
  const paidPoll = paidPollAvailable && path === ROUTINE_PAID_POLL_PATH;
  const paidUpload = paidUploadAvailable && path === ROUTINE_PAID_UPLOAD_PATH;
  const expectedContentType = paidUpload
    ? ROUTINE_PAID_UPLOAD_CONTENT_TYPE
    : paidPoll
      ? ROUTINE_PAID_POLL_CONTENT_TYPE
      : routineLimit === undefined
        ? TELEBIRR_DEVICE_BRIDGE_CONTENT_TYPE
        : ROUTINE_NO_MONEY_CONTENT_TYPE;
  if (
    method !== 'POST' ||
    typeof path !== 'string' ||
    (!paths.has(path) && routineLimit === undefined && !paidPoll && !paidUpload) ||
    contentTypes?.length !== 1 ||
    contentTypes[0] !== expectedContentType ||
    contentLengths?.length !== 1 ||
    !/^[1-9][0-9]{0,5}$/u.test(contentLengths[0] ?? '') ||
    contentEncodings?.length !== 0 ||
    transferEncodings?.length !== 0 ||
    expects?.length !== 0
  ) {
    return undefined;
  }
  const parsed = Number(contentLengths[0]);
  return Number.isSafeInteger(parsed) &&
    parsed > 0 &&
    parsed <=
      (paidUpload
        ? ROUTINE_PAID_UPLOAD_MAX_REQUEST_BYTES
        : paidPoll
          ? ROUTINE_PAID_POLL_MAX_REQUEST_BYTES
          : (routineLimit ?? TELEBIRR_DEVICE_BRIDGE_MAX_REQUEST_BYTES))
    ? parsed
    : undefined;
}

async function readExactBody(
  request: IncomingMessage,
  expectedBytes: number,
): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunkValue of request) {
    const chunk = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue);
    receivedBytes += chunk.byteLength;
    if (receivedBytes > expectedBytes) return undefined;
    chunks.push(chunk);
  }
  return receivedBytes === expectedBytes ? Buffer.concat(chunks, receivedBytes) : undefined;
}

function opaqueError(statusCode: 400 | 503, code: 'invalid_request' | 'temporarily_unavailable') {
  const body = Buffer.from(JSON.stringify({ code }), 'utf8');
  return Object.freeze({ statusCode, headers: errorHeaders, body });
}

function safeResponse(
  candidate: TelebirrDeviceBridgeHttpResponse,
  routineType?:
    | typeof ROUTINE_NO_MONEY_CONTENT_TYPE
    | typeof ROUTINE_PAID_POLL_CONTENT_TYPE
    | typeof ROUTINE_PAID_UPLOAD_CONTENT_TYPE,
): TelebirrDeviceBridgeHttpResponse {
  const routine = routineType !== undefined;
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    !Number.isSafeInteger(candidate.statusCode) ||
    candidate.statusCode < 200 ||
    candidate.statusCode > 599 ||
    typeof candidate.headers !== 'object' ||
    candidate.headers === null ||
    !(candidate.body instanceof Uint8Array) ||
    candidate.body.byteLength === 0 ||
    candidate.body.byteLength >
      (routine ? ROUTINE_MAX_RESPONSE_BYTES : TELEBIRR_DEVICE_BRIDGE_MAX_RESPONSE_BYTES)
  ) {
    return opaqueError(503, 'temporarily_unavailable');
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(candidate.headers)) {
    const normalized = name.toLowerCase();
    if (
      normalized !== name ||
      !/^[a-z0-9-]+$/u.test(name) ||
      typeof value !== 'string' ||
      /[\0\r\n]/u.test(value) ||
      normalized === 'content-length' ||
      normalized === 'connection' ||
      Object.hasOwn(headers, normalized)
    ) {
      return opaqueError(503, 'temporarily_unavailable');
    }
    headers[normalized] = value;
  }
  if (routine) {
    if (
      !routineStatuses.has(candidate.statusCode) ||
      headers['content-type'] !== routineType ||
      headers['cache-control'] !== 'no-store'
    ) {
      return opaqueError(503, 'temporarily_unavailable');
    }
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
        candidate.body,
      );
      if (decoded.charCodeAt(0) === 0xfeff) throw new Error();
      const parsed: unknown = JSON.parse(decoded);
      if (
        JSON.stringify(parsed) !== decoded ||
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      )
        throw new Error();
      if (candidate.statusCode === 200 || candidate.statusCode === 202) {
        if (
          !('advisoryOnly' in parsed) ||
          parsed.advisoryOnly !== true ||
          !('financialActionAllowed' in parsed) ||
          parsed.financialActionAllowed !== false ||
          (routineType === ROUTINE_PAID_POLL_CONTENT_TYPE &&
            (candidate.statusCode !== 200 ||
              !('paymentVerificationRequested' in parsed) ||
              parsed.paymentVerificationRequested !== true ||
              !('outcome' in parsed) ||
              (parsed.outcome !== 'no_assignment' && parsed.outcome !== 'assignment'))) ||
          (routineType === ROUTINE_PAID_UPLOAD_CONTENT_TYPE &&
            (candidate.statusCode !== 202 ||
              !('paymentVerificationRequested' in parsed) ||
              parsed.paymentVerificationRequested !== true ||
              !('pairedPhoneEvidenceVerified' in parsed) ||
              parsed.pairedPhoneEvidenceVerified !== true ||
              !('outcome' in parsed) ||
              parsed.outcome !== 'signed_paid_observation_staged')) ||
          (candidate.statusCode === 202 &&
            (!('sourceAuthenticationPerformed' in parsed) ||
              parsed.sourceAuthenticationPerformed !== false))
        )
          throw new Error();
        if (routineType === ROUTINE_PAID_POLL_CONTENT_TYPE) {
          const paidValue = parsed as Record<string, unknown>;
          const expected =
            paidValue.outcome === 'assignment'
              ? [
                  'outcome',
                  'advisoryOnly',
                  'paymentVerificationRequested',
                  'financialActionAllowed',
                  'signedAssignment',
                ]
              : [
                  'outcome',
                  'advisoryOnly',
                  'paymentVerificationRequested',
                  'financialActionAllowed',
                ];
          const actual = Object.keys(parsed);
          if (
            actual.length !== expected.length ||
            actual.some((key) => !expected.includes(key)) ||
            (paidValue.outcome === 'assignment' &&
              (typeof paidValue.signedAssignment !== 'object' ||
                paidValue.signedAssignment === null ||
                Array.isArray(paidValue.signedAssignment)))
          )
            throw new Error();
        }
        if (routineType === ROUTINE_PAID_UPLOAD_CONTENT_TYPE) {
          const expected = [
            'outcome',
            'advisoryOnly',
            'paymentVerificationRequested',
            'pairedPhoneEvidenceVerified',
            'sourceAuthenticationPerformed',
            'financialActionAllowed',
          ];
          const actual = Object.keys(parsed);
          if (actual.length !== expected.length || actual.some((key) => !expected.includes(key)))
            throw new Error();
        }
      } else {
        if (
          Object.keys(parsed).length !== 1 ||
          !('code' in parsed) ||
          !routineErrorCodes.has(parsed.code as string)
        )
          throw new Error();
      }
    } catch {
      return opaqueError(503, 'temporarily_unavailable');
    }
  }
  return Object.freeze({
    statusCode: candidate.statusCode,
    headers: Object.freeze(headers),
    body: Buffer.from(candidate.body),
  });
}

function writeResponse(
  target: ServerResponse,
  source: TelebirrDeviceBridgeHttpResponse,
  routineType?:
    | typeof ROUTINE_NO_MONEY_CONTENT_TYPE
    | typeof ROUTINE_PAID_POLL_CONTENT_TYPE
    | typeof ROUTINE_PAID_UPLOAD_CONTENT_TYPE,
): void {
  const selected = safeResponse(source, routineType);
  target.writeHead(selected.statusCode, {
    ...selected.headers,
    connection: 'close',
    'content-length': String(selected.body.byteLength),
  });
  target.end(selected.body);
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise<void>((resolvePromise, rejectPromise) => {
    server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
  });
}

/**
 * Creates the internal plain-HTTP listener intended only for a private Docker network behind the
 * reviewed HTTPS gateway. Deployment must not publish this port directly to the host or Internet.
 */
export function createTelebirrDeviceBridgeHttpServer(
  handler: TelebirrDeviceBridgeHandler,
  options: {
    readonly host: typeof TELEBIRR_DEVICE_BRIDGE_LISTEN_HOST;
    readonly port: typeof TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT;
  },
  routineHandler?: TelebirrDeviceBridgeHandler,
  paidPollHandler?: TelebirrDeviceBridgeHandler,
  paidUploadHandler?: TelebirrDeviceBridgeHandler,
): TelebirrDeviceBridgeHttpServerRuntime {
  if (
    typeof handler !== 'function' ||
    options.host !== TELEBIRR_DEVICE_BRIDGE_LISTEN_HOST ||
    options.port !== TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT ||
    (routineHandler !== undefined && typeof routineHandler !== 'function') ||
    (paidPollHandler !== undefined && typeof paidPollHandler !== 'function') ||
    (paidUploadHandler !== undefined && typeof paidUploadHandler !== 'function')
  ) {
    throw new TelebirrDeviceBridgeHttpServerError();
  }
  let available = false;
  let closed = false;
  const server = createServer({ maxHeaderSize: 8_192 }, (request, target) => {
    void (async () => {
      try {
        const headers = rawHeaders(request);
        const routine = routineHandler !== undefined && routineRequestLimits.has(request.url ?? '');
        const paidPoll = paidPollHandler !== undefined && request.url === ROUTINE_PAID_POLL_PATH;
        const paidUpload =
          paidUploadHandler !== undefined && request.url === ROUTINE_PAID_UPLOAD_PATH;
        const expectedBytes =
          headers &&
          declaredBodyLength(
            request.method,
            request.url,
            headers,
            routineHandler !== undefined,
            paidPollHandler !== undefined,
            paidUploadHandler !== undefined,
          );
        if (headers === undefined || expectedBytes === undefined) {
          request.resume();
          writeResponse(target, opaqueError(400, 'invalid_request'));
          return;
        }
        request.setTimeout(7_000, () => request.destroy());
        const body = await readExactBody(request, expectedBytes);
        if (body === undefined) {
          writeResponse(target, opaqueError(400, 'invalid_request'));
          return;
        }
        writeResponse(
          target,
          await (
            paidUpload
              ? paidUploadHandler
              : paidPoll
                ? paidPollHandler
                : routine
                  ? routineHandler
                  : handler
          )({
            method: request.method ?? '',
            path: request.url ?? '',
            headers,
            body,
          }),
          paidUpload
            ? ROUTINE_PAID_UPLOAD_CONTENT_TYPE
            : paidPoll
              ? ROUTINE_PAID_POLL_CONTENT_TYPE
              : routine
                ? ROUTINE_NO_MONEY_CONTENT_TYPE
                : undefined,
        );
      } catch {
        if (!target.headersSent) {
          writeResponse(target, opaqueError(503, 'temporarily_unavailable'));
        } else {
          target.destroy();
        }
      }
    })();
  });
  server.maxConnections = 64;
  server.maxRequestsPerSocket = 1;
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 1_000;
  server.on('error', () => {
    available = false;
  });

  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    server,
    listen: async () => {
      try {
        if (closed || server.listening || available) throw new Error();
        await new Promise<void>((resolvePromise, rejectPromise) => {
          const failed = (error: Error) => {
            server.off('listening', listening);
            rejectPromise(error);
          };
          const listening = () => {
            server.off('error', failed);
            resolvePromise();
          };
          server.once('error', failed);
          server.once('listening', listening);
          server.listen(options.port, options.host);
        });
        const address = server.address();
        if (
          address === null ||
          typeof address === 'string' ||
          address.address !== options.host ||
          address.port !== options.port
        ) {
          throw new Error();
        }
        available = true;
      } catch {
        available = false;
        await closeServer(server).catch(() => undefined);
        throw new TelebirrDeviceBridgeHttpServerError();
      }
    },
    ready: () => available && !closed && server.listening,
    close: () => {
      closePromise ??= (async () => {
        closed = true;
        available = false;
        try {
          await closeServer(server);
        } catch {
          throw new TelebirrDeviceBridgeHttpServerError();
        }
      })();
      return closePromise;
    },
  });
}
