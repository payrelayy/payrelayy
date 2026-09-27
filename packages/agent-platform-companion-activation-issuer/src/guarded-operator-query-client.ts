import type { GuardedOperatorAdministrator } from './guarded-operator-lifecycle-lock.js';
import {
  protectedOperatorQueryName,
  type ProtectedOperatorQueryName,
} from './protected-operator-query-catalog.js';

export interface GuardedOperatorRemoteSession {
  readonly backendPid: number;
  readonly lost: Promise<never>;
  execute(
    name: ProtectedOperatorQueryName,
    values: readonly unknown[],
  ): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
  close(): Promise<void>;
}

export interface GuardedOperatorQueryClient {
  readonly administrator: GuardedOperatorAdministrator;
  close(): Promise<void>;
}

export class GuardedOperatorQueryClientUnavailableError extends Error {
  readonly requiresIndependentStopAndReconciliation = true;

  constructor() {
    super('The guarded operator query client is unavailable.');
    this.name = 'GuardedOperatorQueryClientUnavailableError';
  }
}

/**
 * The Windows coordinator sees only the ten exact reviewed operations, never
 * a database URL or credential. A future private, paired transport supplies
 * the remote session; a raw SQL string outside the pinned catalog is refused
 * before crossing that transport. Connection loss invalidates the lifecycle
 * lock and must trigger the independent stop.
 */
export function createGuardedOperatorQueryClient(
  remote: GuardedOperatorRemoteSession,
): GuardedOperatorQueryClient {
  if (
    !remote ||
    !Number.isInteger(remote.backendPid) ||
    remote.backendPid < 1 ||
    typeof remote.execute !== 'function' ||
    typeof remote.close !== 'function' ||
    typeof remote.lost?.then !== 'function'
  )
    throw new GuardedOperatorQueryClientUnavailableError();

  let closed = false;
  let lost = false;
  const listeners = new Map<'error' | 'end', Set<() => void>>([
    ['error', new Set()],
    ['end', new Set()],
  ]);
  const notify = (): void => {
    if (closed || lost) return;
    lost = true;
    for (const listener of listeners.get('error')!) {
      try {
        listener();
      } catch {
        // The session is already lost; one listener cannot restore authority.
      }
    }
  };
  void remote.lost.then(notify, notify);

  return Object.freeze({
    administrator: Object.freeze({
      processID: remote.backendPid,
      on(event: 'error' | 'end', listener: () => void): void {
        if (!listeners.has(event) || typeof listener !== 'function')
          throw new GuardedOperatorQueryClientUnavailableError();
        listeners.get(event)!.add(listener);
        if (lost) listener();
      },
      off(event: 'error' | 'end', listener: () => void): void {
        listeners.get(event)?.delete(listener);
      },
      async query(
        sql: string,
        values: unknown[],
      ): Promise<{ readonly rows: readonly Record<string, unknown>[] }> {
        try {
          const name = protectedOperatorQueryName(sql);
          if (closed || lost || !name || !Array.isArray(values)) throw new Error();
          const result = await remote.execute(name, values);
          if (closed || lost || !result || !Array.isArray(result.rows)) throw new Error();
          return result;
        } catch {
          notify();
          throw new GuardedOperatorQueryClientUnavailableError();
        }
      },
    }) satisfies GuardedOperatorAdministrator,
    async close(): Promise<void> {
      if (closed) throw new GuardedOperatorQueryClientUnavailableError();
      closed = true;
      try {
        await remote.close();
      } catch {
        throw new GuardedOperatorQueryClientUnavailableError();
      } finally {
        listeners.get('error')!.clear();
        listeners.get('end')!.clear();
      }
    },
  });
}
