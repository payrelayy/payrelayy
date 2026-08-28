import { request } from 'node:http';

const CONTROL_SOCKET = '/run/fetanagent-kemerbet-session-control/session.sock';
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export type OwnerKemerbetSessionPhase =
  | 'authenticated'
  | 'authenticating'
  | 'checkpointed'
  | 'faulted'
  | 'idle'
  | 'login_required'
  | 'starting'
  | 'stopping';

export type OwnerKemerbetSessionQuarantineReason =
  'browser_cleanup_unverified' | 'profile_integrity_unverified' | 'unclean_session_generation';

export interface OwnerKemerbetSessionQuarantine {
  readonly reasonCode: OwnerKemerbetSessionQuarantineReason;
  readonly recoveryRequired: true;
}

export interface OwnerKemerbetSessionStatus {
  readonly active: boolean;
  readonly expiresAt?: string;
  readonly frameSequence?: number;
  readonly generation?: string;
  readonly loginRequired: boolean;
  readonly phase: OwnerKemerbetSessionPhase;
  readonly quarantine?: OwnerKemerbetSessionQuarantine;
  readonly signedIn: boolean;
  readonly transferDisabled: true;
}

export interface OwnerKemerbetSessionFrame {
  readonly generation: string;
  readonly image: Buffer;
  readonly sequence: number;
}

export type OwnerKemerbetSessionInput =
  | {
      readonly frameSequence: number;
      readonly kind: 'key';
      readonly key: string;
      readonly requestId: string;
      readonly sessionGeneration: string;
    }
  | {
      readonly frameSequence: number;
      readonly kind: 'text';
      readonly requestId: string;
      readonly sessionGeneration: string;
      readonly text: string;
    }
  | {
      readonly frameSequence: number;
      readonly kind: 'pointer';
      readonly requestId: string;
      readonly sessionGeneration: string;
      readonly x: number;
      readonly y: number;
    };

export interface OwnerKemerbetSessionControl {
  frame(
    platformAgentAccountId: string,
    generation: string,
    after: number,
  ): Promise<OwnerKemerbetSessionFrame | undefined>;
  input(
    platformAgentAccountId: string,
    value: OwnerKemerbetSessionInput,
  ): Promise<OwnerKemerbetSessionStatus>;
  start(platformAgentAccountId: string, requestId: string): Promise<OwnerKemerbetSessionStatus>;
  status(platformAgentAccountId: string): Promise<OwnerKemerbetSessionStatus>;
  stop(platformAgentAccountId: string, requestId: string): Promise<OwnerKemerbetSessionStatus>;
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
  const quarantined = object.active === false && object.quarantine !== undefined;
  const exactKeys = object.active
    ? [
        'active',
        'expiresAt',
        'frameSequence',
        'generation',
        'loginRequired',
        'phase',
        'signedIn',
        'transferDisabled',
      ]
    : quarantined
      ? ['active', 'loginRequired', 'phase', 'quarantine', 'signedIn', 'transferDisabled']
      : ['active', 'loginRequired', 'phase', 'signedIn', 'transferDisabled'];
  const activePhases = new Set([
    'authenticated',
    'authenticating',
    'faulted',
    'login_required',
    'starting',
    'stopping',
  ]);
  const inactivePhases = new Set(['checkpointed', 'idle']);
  const quarantineReasons = new Set<unknown>([
    'browser_cleanup_unverified',
    'profile_integrity_unverified',
    'unclean_session_generation',
  ]);
  const quarantine = object.quarantine as Record<string, unknown> | undefined;
  if (
    Object.keys(object).sort().join('\0') !== exactKeys.sort().join('\0') ||
    typeof object.active !== 'boolean' ||
    typeof object.loginRequired !== 'boolean' ||
    typeof object.phase !== 'string' ||
    typeof object.signedIn !== 'boolean' ||
    object.transferDisabled !== true ||
    (object.active &&
      (typeof object.expiresAt !== 'string' ||
        !Number.isFinite(Date.parse(object.expiresAt)) ||
        typeof object.generation !== 'string' ||
        !REQUEST_ID_PATTERN.test(object.generation) ||
        !Number.isSafeInteger(object.frameSequence) ||
        Number(object.frameSequence) < 0 ||
        !activePhases.has(object.phase))) ||
    (!object.active && !inactivePhases.has(object.phase)) ||
    (quarantined &&
      (typeof quarantine !== 'object' ||
        quarantine === null ||
        Array.isArray(quarantine) ||
        Object.keys(quarantine).sort().join('\0') !==
          ['reasonCode', 'recoveryRequired'].join('\0') ||
        !quarantineReasons.has(quarantine.reasonCode) ||
        quarantine.recoveryRequired !== true ||
        object.phase !== 'idle')) ||
    (!object.active && (object.loginRequired || object.signedIn)) ||
    (object.signedIn && (object.loginRequired || object.phase !== 'authenticated')) ||
    (object.loginRequired && object.phase !== 'login_required')
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
          if (
            response.statusCode !== 200 &&
            response.statusCode !== 201 &&
            response.statusCode !== 202
          ) {
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

async function callFrame(
  platformAgentAccountId: string,
  generation: string,
  after: number,
): Promise<OwnerKemerbetSessionFrame | undefined> {
  return new Promise<OwnerKemerbetSessionFrame | undefined>((resolvePromise, rejectPromise) => {
    const candidate = request(
      {
        method: 'GET',
        path:
          `/v1/session/frame?platformAgentAccountId=${encodeURIComponent(platformAgentAccountId)}` +
          `&generation=${encodeURIComponent(generation)}&after=${String(after)}`,
        socketPath: CONTROL_SOCKET,
        timeout: 7_000,
      },
      (response) => {
        const responseGeneration = response.headers['x-fetanagent-session-generation'];
        const responseSequence = response.headers['x-fetanagent-frame-sequence'];
        const sequence =
          typeof responseSequence === 'string' && /^(?:0|[1-9][0-9]{0,9})$/u.test(responseSequence)
            ? Number(responseSequence)
            : undefined;
        if (
          responseGeneration !== generation ||
          sequence === undefined ||
          !Number.isSafeInteger(sequence)
        ) {
          response.resume();
          rejectPromise(new OwnerKemerbetSessionUnavailableError());
          return;
        }
        if (response.statusCode === 204) {
          response.resume();
          resolvePromise(undefined);
          return;
        }
        if (
          response.statusCode !== 200 ||
          response.headers['content-type'] !== 'image/jpeg' ||
          sequence <= after
        ) {
          response.resume();
          rejectPromise(new OwnerKemerbetSessionUnavailableError());
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunkValue: Buffer | string) => {
          const chunk = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue);
          size += chunk.byteLength;
          if (size > MAX_RESPONSE_BYTES) response.destroy();
          else chunks.push(chunk);
        });
        response.once('end', () => {
          const image = Buffer.concat(chunks);
          if (
            image.byteLength < 4 ||
            image[0] !== 0xff ||
            image[1] !== 0xd8 ||
            image.at(-2) !== 0xff ||
            image.at(-1) !== 0xd9
          ) {
            rejectPromise(new OwnerKemerbetSessionUnavailableError());
            return;
          }
          resolvePromise(Object.freeze({ generation, image, sequence }));
        });
        response.once('aborted', () => rejectPromise(new OwnerKemerbetSessionUnavailableError()));
        response.once('error', () => rejectPromise(new OwnerKemerbetSessionUnavailableError()));
      },
    );
    candidate.once('timeout', () => candidate.destroy());
    candidate.once('error', () => rejectPromise(new OwnerKemerbetSessionUnavailableError()));
    candidate.end();
  });
}

export class UnixOwnerKemerbetSessionControl implements OwnerKemerbetSessionControl {
  async frame(
    platformAgentAccountId: string,
    generation: string,
    after: number,
  ): Promise<OwnerKemerbetSessionFrame | undefined> {
    if (
      !UUID_PATTERN.test(platformAgentAccountId) ||
      !REQUEST_ID_PATTERN.test(generation) ||
      !Number.isSafeInteger(after) ||
      after < 0 ||
      after > 9_999_999_999
    ) {
      throw new OwnerKemerbetSessionRejectedError();
    }
    return callFrame(platformAgentAccountId, generation, after);
  }

  async status(platformAgentAccountId: string): Promise<OwnerKemerbetSessionStatus> {
    if (!UUID_PATTERN.test(platformAgentAccountId)) {
      throw new OwnerKemerbetSessionRejectedError();
    }
    return callControl(
      'GET',
      `/v1/session?platformAgentAccountId=${encodeURIComponent(platformAgentAccountId)}`,
    );
  }

  async start(
    platformAgentAccountId: string,
    requestId: string,
  ): Promise<OwnerKemerbetSessionStatus> {
    if (!UUID_PATTERN.test(platformAgentAccountId) || !REQUEST_ID_PATTERN.test(requestId)) {
      throw new OwnerKemerbetSessionRejectedError();
    }
    return callControl('POST', '/v1/session/start', { platformAgentAccountId, requestId });
  }

  async input(
    platformAgentAccountId: string,
    value: OwnerKemerbetSessionInput,
  ): Promise<OwnerKemerbetSessionStatus> {
    if (
      !UUID_PATTERN.test(platformAgentAccountId) ||
      !REQUEST_ID_PATTERN.test(value.requestId) ||
      !REQUEST_ID_PATTERN.test(value.sessionGeneration) ||
      !Number.isSafeInteger(value.frameSequence) ||
      value.frameSequence < 1
    ) {
      throw new OwnerKemerbetSessionRejectedError();
    }
    return callControl('POST', '/v1/session/input', { ...value, platformAgentAccountId });
  }

  async stop(
    platformAgentAccountId: string,
    requestId: string,
  ): Promise<OwnerKemerbetSessionStatus> {
    if (!UUID_PATTERN.test(platformAgentAccountId) || !REQUEST_ID_PATTERN.test(requestId)) {
      throw new OwnerKemerbetSessionRejectedError();
    }
    return callControl('POST', '/v1/session/stop', { platformAgentAccountId, requestId });
  }
}
