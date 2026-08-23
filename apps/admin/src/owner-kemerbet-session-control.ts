import { request } from 'node:http';

const CONTROL_SOCKET = '/run/fetanagent-kemerbet-session-control/session.sock';
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface OwnerKemerbetSessionStatus {
  readonly active: boolean;
  readonly expiresAt?: string;
  readonly imageBase64?: string;
  readonly imageContentType?: 'image/jpeg';
  readonly loginRequired: boolean;
  readonly signedIn: boolean;
  readonly transferDisabled: true;
}

export type OwnerKemerbetSessionInput =
  | { readonly kind: 'key'; readonly key: string; readonly requestId: string }
  | {
      readonly kind: 'pointer';
      readonly requestId: string;
      readonly x: number;
      readonly y: number;
    };

export interface OwnerKemerbetSessionControl {
  input(value: OwnerKemerbetSessionInput): Promise<OwnerKemerbetSessionStatus>;
  start(platformAgentAccountId: string, requestId: string): Promise<OwnerKemerbetSessionStatus>;
  status(): Promise<OwnerKemerbetSessionStatus>;
  stop(requestId: string): Promise<OwnerKemerbetSessionStatus>;
}

export class OwnerKemerbetSessionRejectedError extends Error {
  constructor() {
    super('The Owner KemerBet session operation was rejected.');
    this.name = 'OwnerKemerbetSessionRejectedError';
  }
}

export class OwnerKemerbetSessionUnavailableError extends Error {
  constructor() {
    super('The Owner KemerBet session operation is unavailable.');
    this.name = 'OwnerKemerbetSessionUnavailableError';
  }
}

export function parseOwnerKemerbetSessionStatus(value: unknown): OwnerKemerbetSessionStatus {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OwnerKemerbetSessionUnavailableError();
  }
  const object = value as Record<string, unknown>;
  const exactKeys = object.active
    ? [
        'active',
        'expiresAt',
        'imageBase64',
        'imageContentType',
        'loginRequired',
        'signedIn',
        'transferDisabled',
      ]
    : ['active', 'loginRequired', 'signedIn', 'transferDisabled'];
  if (
    Object.keys(object).sort().join('\0') !== exactKeys.sort().join('\0') ||
    typeof object.active !== 'boolean' ||
    typeof object.loginRequired !== 'boolean' ||
    typeof object.signedIn !== 'boolean' ||
    object.transferDisabled !== true ||
    (object.active &&
      (typeof object.expiresAt !== 'string' ||
        !Number.isFinite(Date.parse(object.expiresAt)) ||
        object.imageContentType !== 'image/jpeg' ||
        typeof object.imageBase64 !== 'string' ||
        object.imageBase64.length < 4 ||
        object.imageBase64.length > 1_900_000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/u.test(object.imageBase64))) ||
    (!object.active && (object.loginRequired || object.signedIn)) ||
    (object.signedIn && object.loginRequired)
  ) {
    throw new OwnerKemerbetSessionUnavailableError();
  }
  return Object.freeze(object as unknown as OwnerKemerbetSessionStatus);
}

async function callControl(
  method: 'GET' | 'POST',
  path: string,
  body?: Readonly<Record<string, unknown>>,
  timeoutMs = 5_000,
): Promise<OwnerKemerbetSessionStatus> {
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  return new Promise<OwnerKemerbetSessionStatus>((resolvePromise, rejectPromise) => {
    const candidate = request(
      {
        headers:
          serialized === undefined
            ? undefined
            : {
                'content-length': Buffer.byteLength(serialized),
                'content-type': 'application/json',
              },
        method,
        path,
        socketPath: CONTROL_SOCKET,
        timeout: timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunkValue: Buffer | string) => {
          const chunk = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue);
          size += chunk.byteLength;
          if (size > MAX_RESPONSE_BYTES) response.destroy();
          else chunks.push(chunk);
        });
        response.once('end', () => {
          if (response.statusCode !== 200 && response.statusCode !== 201) {
            rejectPromise(new OwnerKemerbetSessionUnavailableError());
            return;
          }
          try {
            resolvePromise(
              parseOwnerKemerbetSessionStatus(JSON.parse(Buffer.concat(chunks).toString('utf8'))),
            );
          } catch {
            rejectPromise(new OwnerKemerbetSessionUnavailableError());
          }
        });
        response.once('aborted', () => rejectPromise(new OwnerKemerbetSessionUnavailableError()));
        response.once('error', () => rejectPromise(new OwnerKemerbetSessionUnavailableError()));
      },
    );
    candidate.once('timeout', () => candidate.destroy());
    candidate.once('error', () => rejectPromise(new OwnerKemerbetSessionUnavailableError()));
    if (serialized !== undefined) candidate.end(serialized);
    else candidate.end();
  });
}

export class UnixOwnerKemerbetSessionControl implements OwnerKemerbetSessionControl {
  async status(): Promise<OwnerKemerbetSessionStatus> {
    return callControl('GET', '/v1/session');
  }

  async start(
    platformAgentAccountId: string,
    requestId: string,
  ): Promise<OwnerKemerbetSessionStatus> {
    if (!UUID_PATTERN.test(platformAgentAccountId) || !REQUEST_ID_PATTERN.test(requestId)) {
      throw new OwnerKemerbetSessionRejectedError();
    }
    return callControl('POST', '/v1/session/start', { platformAgentAccountId, requestId }, 35_000);
  }

  async input(value: OwnerKemerbetSessionInput): Promise<OwnerKemerbetSessionStatus> {
    if (!REQUEST_ID_PATTERN.test(value.requestId)) throw new OwnerKemerbetSessionRejectedError();
    return callControl('POST', '/v1/session/input', value);
  }

  async stop(requestId: string): Promise<OwnerKemerbetSessionStatus> {
    if (!REQUEST_ID_PATTERN.test(requestId)) throw new OwnerKemerbetSessionRejectedError();
    return callControl('POST', '/v1/session/stop', { requestId });
  }
}
