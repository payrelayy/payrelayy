import type { GuardedOperatorAdministrator } from './guarded-operator-lifecycle-lock.js';
import {
  protectedOperatorQueries,
  type ProtectedOperatorQueryName,
} from './protected-operator-query-catalog.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const EPOCH = /^[1-9][0-9]{0,18}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const HEX_PASSWORD = /^[0-9a-f]{64}$/u;
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const LOCK_NAMESPACE = 1178682452;
const LOCK_OPERATION = 1329885472;
const PRE_ACTIVATION_IDLE_MS = 10 * 60_000;
// The reviewed independent database watchdog fences an unrenewed activation
// within its short lease. Leave enough time for the bounded emergency-stop
// operation itself before considering this operator session abandoned.
const ACTIVE_IDLE_MS = 120_000;
const MAX_ROWS = 2;

async function bounded<T>(operation: () => Promise<T>, durationMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error()), durationMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export interface ProtectedOperatorQuerySessionInput {
  /** Dedicated server-owned postgres Client, never supplied to the Windows process. */
  readonly administrator: GuardedOperatorAdministrator;
  /** Must have been authenticated against the live paired certificate upstream. */
  readonly requestKey: string;
  /** Independent Postgres emergency-disable operation on a different connection. */
  readonly disableDatabase: () => Promise<unknown>;
  /** Closes the exact dedicated connection after stop and unlock attempts. */
  readonly closeAdministrator: () => Promise<void>;
}

export interface ProtectedOperatorQuerySession {
  readonly backendPid: number;
  readonly lost: Promise<never>;
  execute(
    name: ProtectedOperatorQueryName,
    values: readonly unknown[],
  ): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
  close(): Promise<void>;
}

export class ProtectedOperatorQuerySessionUnavailableError extends Error {
  readonly requiresIndependentStopAndReconciliation = true;

  constructor() {
    super('The protected operator query session is unavailable.');
    this.name = 'ProtectedOperatorQuerySessionUnavailableError';
  }
}

function exactInstant(value: unknown): value is string {
  if (typeof value !== 'string' || !UTC_INSTANT.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function exactValues(
  name: ProtectedOperatorQueryName,
  values: readonly unknown[],
  requestKey: string,
  backendPid: number,
  epoch?: string,
  approvedJobId?: string,
): boolean {
  if (!Array.isArray(values)) return false;
  switch (name) {
    case 'acquire':
    case 'release':
      return (
        values.length === 3 &&
        values[0] === LOCK_NAMESPACE &&
        values[1] === LOCK_OPERATION &&
        values[2] === backendPid
      );
    case 'snapshot':
    case 'attestation':
    case 'approvedJob':
      return values.length === 1 && values[0] === requestKey;
    case 'watchdogReady':
      return values.length === 0;
    case 'watchdogRenew':
      return values.length === 1 && values[0] === epoch && typeof epoch === 'string';
    case 'outcome':
      return (
        values.length === 2 &&
        values[0] === requestKey &&
        values[1] === approvedJobId &&
        typeof approvedJobId === 'string'
      );
    case 'activate':
      return (
        values.length === 3 &&
        typeof values[0] === 'string' &&
        UUID_V4.test(values[0]) &&
        values[1] === requestKey &&
        typeof values[2] === 'string' &&
        HEX_PASSWORD.test(values[2])
      );
    case 'retain':
      return (
        values.length === 14 &&
        values[0] === requestKey &&
        [1, 3, 4, 5, 6, 7].every(
          (index) => typeof values[index] === 'string' && SHA256.test(values[index]),
        ) &&
        typeof values[2] === 'string' &&
        /^[0-9a-f]{40}$/u.test(values[2]) &&
        Number.isInteger(values[8]) &&
        (values[8] as number) > 0 &&
        (values[8] as number) <= 2_147_483_647 &&
        [9, 10, 11, 12, 13].every((index) => exactInstant(values[index]))
      );
  }
}

function oneRowField(
  result: { readonly rows: readonly Record<string, unknown>[] },
  field: string,
): unknown {
  if (result.rows.length !== 1 || !result.rows[0]) throw new Error();
  return result.rows[0][field];
}

/**
 * The protected host retains the only administrator connection and executes a
 * finite, source-pinned catalog. This is an internal session core, not a public
 * endpoint or production credential loader. Its caller must authenticate the
 * paired device and bind a private transport to one request before exposing it.
 * Any activation-call uncertainty invokes the independent database stop.
 */
export function createProtectedOperatorQuerySession(
  input: ProtectedOperatorQuerySessionInput,
): ProtectedOperatorQuerySession {
  const administrator = input?.administrator;
  if (
    !administrator ||
    !Number.isInteger(administrator.processID) ||
    administrator.processID < 1 ||
    typeof administrator.query !== 'function' ||
    typeof administrator.on !== 'function' ||
    typeof administrator.off !== 'function' ||
    !input ||
    !UUID_V4.test(input.requestKey) ||
    typeof input.disableDatabase !== 'function' ||
    typeof input.closeAdministrator !== 'function'
  )
    throw new ProtectedOperatorQuerySessionUnavailableError();

  let closed = false;
  let locked = false;
  let snapshotLoaded = false;
  let retained = false;
  let watchdogReady = false;
  let attestationChecked = false;
  let activationAttempted = false;
  let activated = false;
  let epoch: string | undefined;
  let approvedJobId: string | undefined;
  let idleTimer: NodeJS.Timeout | undefined;
  let closePromise: Promise<void> | undefined;
  let pending: Promise<unknown> = Promise.resolve();
  let rejectLost!: (error: ProtectedOperatorQuerySessionUnavailableError) => void;
  const lost = new Promise<never>((_, reject) => {
    rejectLost = reject;
  });
  void lost.catch(() => undefined);

  const onConnectionLoss = (): void => {
    if (closed) return;
    rejectLost(new ProtectedOperatorQuerySessionUnavailableError());
    void close().catch(() => undefined);
  };
  administrator.on('error', onConnectionLoss);
  administrator.on('end', onConnectionLoss);

  const armIdle = (): void => {
    if (closed) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => {
        rejectLost(new ProtectedOperatorQuerySessionUnavailableError());
        void close().catch(() => undefined);
      },
      activated ? ACTIVE_IDLE_MS : PRE_ACTIVATION_IDLE_MS,
    );
  };

  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    closed = true;
    clearTimeout(idleTimer);
    closePromise = (async () => {
      let failed = false;
      // The transition may have committed even if its response was lost.
      if (activationAttempted) {
        try {
          await bounded(input.disableDatabase, 105_000);
        } catch {
          failed = true;
        }
      }
      if (locked) {
        try {
          const result = await bounded(
            () =>
              administrator.query(protectedOperatorQueries.release, [
                LOCK_NAMESPACE,
                LOCK_OPERATION,
                administrator.processID,
              ]),
            5_000,
          );
          if (oneRowField(result, 'released') !== true) failed = true;
        } catch {
          failed = true;
        }
      }
      try {
        await bounded(input.closeAdministrator, 10_000);
      } catch {
        failed = true;
      } finally {
        administrator.off('error', onConnectionLoss);
        administrator.off('end', onConnectionLoss);
      }
      if (failed) throw new ProtectedOperatorQuerySessionUnavailableError();
    })();
    return closePromise;
  };

  armIdle();
  return Object.freeze({
    backendPid: administrator.processID,
    lost,
    close,
    execute(
      name: ProtectedOperatorQueryName,
      values: readonly unknown[],
    ): Promise<{ readonly rows: readonly Record<string, unknown>[] }> {
      const task = pending.then(async () => {
        try {
          if (closed || !Object.hasOwn(protectedOperatorQueries, name)) throw new Error();
          if (
            !exactValues(
              name,
              values,
              input.requestKey,
              administrator.processID,
              epoch,
              approvedJobId,
            )
          )
            throw new Error();
          if (name === 'acquire') {
            if (locked || snapshotLoaded) throw new Error();
          } else if (!locked) {
            throw new Error();
          }
          if (name === 'snapshot' && (retained || activationAttempted)) throw new Error();
          if (name === 'retain' && (!snapshotLoaded || retained)) throw new Error();
          if (name === 'watchdogReady' && (!retained || watchdogReady)) throw new Error();
          if (name === 'attestation' && (!retained || !watchdogReady || attestationChecked))
            throw new Error();
          if (name === 'activate' && (!attestationChecked || activationAttempted))
            throw new Error();
          if (
            ['watchdogRenew', 'approvedJob', 'outcome'].includes(name) &&
            (!activated || !activationAttempted)
          )
            throw new Error();
          if (name === 'outcome' && !approvedJobId) throw new Error();
          if (name === 'release' && !locked) throw new Error();
          if (name === 'activate') activationAttempted = true;

          const result = await administrator.query(protectedOperatorQueries[name], [...values]);
          if (!result || !Array.isArray(result.rows) || result.rows.length > MAX_ROWS)
            throw new Error();
          if (name === 'acquire') {
            if (oneRowField(result, 'acquired') !== true) throw new Error();
            locked = true;
          } else if (name === 'release') {
            if (oneRowField(result, 'released') !== true) throw new Error();
            locked = false;
          } else if (name === 'snapshot') {
            const seenEpoch = oneRowField(result, 'request_activation_epoch');
            const seenRequest = oneRowField(result, 'request_key');
            if (
              seenRequest !== input.requestKey ||
              typeof seenEpoch !== 'string' ||
              !EPOCH.test(seenEpoch) ||
              (epoch && epoch !== seenEpoch)
            )
              throw new Error();
            epoch = seenEpoch;
            snapshotLoaded = true;
          } else if (name === 'retain') {
            if (oneRowField(result, 'request_key') !== input.requestKey) throw new Error();
            retained = true;
          } else if (name === 'watchdogReady') {
            if (oneRowField(result, 'ready') !== true) throw new Error();
            watchdogReady = true;
          } else if (name === 'attestation') {
            const proofDigest = oneRowField(result, 'proof_digest');
            if (typeof proofDigest !== 'string' || !SHA256.test(proofDigest)) throw new Error();
            attestationChecked = true;
          } else if (name === 'activate') {
            if (!(oneRowField(result, 'valid_until') instanceof Date)) throw new Error();
            activated = true;
          } else if (name === 'approvedJob' && result.rows.length === 1) {
            const jobId = result.rows[0]?.['job_id'];
            if (typeof jobId !== 'string' || !UUID_V4.test(jobId)) throw new Error();
            if (approvedJobId && approvedJobId !== jobId) throw new Error();
            approvedJobId = jobId;
          }
          armIdle();
          return result;
        } catch {
          rejectLost(new ProtectedOperatorQuerySessionUnavailableError());
          void close().catch(() => undefined);
          throw new ProtectedOperatorQuerySessionUnavailableError();
        }
      });
      pending = task.catch(() => undefined);
      return task;
    },
  });
}
