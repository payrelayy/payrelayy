import type { CompanionActivationSnapshotQuery } from './snapshot.js';

const LOCK_NAMESPACE = 1178682452;
const LOCK_OPERATION = 1329885472;

export const ACQUIRE_SQL = `
  select case when session_user = 'postgres'
                   and pg_catalog.pg_backend_pid() = $3::integer
                   and not exists (
                     select 1 from pg_catalog.pg_locks held
                      where held.locktype = 'advisory'
                        and held.pid = pg_catalog.pg_backend_pid()
                        and held.classid = $1::oid
                        and held.objid = $2::oid
                        and held.objsubid = 2
                        and held.granted
                   )
              then pg_catalog.pg_try_advisory_lock($1::integer, $2::integer)
              else false end as acquired
`;
export const RELEASE_SQL = `
  select case when session_user = 'postgres' and pg_catalog.pg_backend_pid() = $3::integer
              then pg_catalog.pg_advisory_unlock($1::integer, $2::integer)
              else false end as released
`;

/** A dedicated pg Client, never a Pool or a Pool.query facade. */
export interface GuardedOperatorAdministrator extends CompanionActivationSnapshotQuery {
  readonly processID: number;
  on(event: 'error' | 'end', listener: () => void): unknown;
  off(event: 'error' | 'end', listener: () => void): unknown;
}

export interface GuardedOperatorLifecycleLock {
  /** A lost dedicated connection invalidates the operator even before release. */
  readonly lost: Promise<never>;
  release(): Promise<void>;
}

export class GuardedOperatorLifecycleLockUnavailableError extends Error {
  readonly requiresIndependentStopAndReconciliation = true;

  constructor() {
    super('The guarded operator lifecycle lock is unavailable.');
    this.name = 'GuardedOperatorLifecycleLockUnavailableError';
  }
}

/**
 * One nonblocking, session-level Postgres advisory lock for the entire local
 * companion activation and result lifecycle. The caller must own one dedicated
 * protected postgres Client and close it after release. A pooled query facade
 * cannot satisfy the processID contract. A dead session releases the lock, but
 * the independent database watchdog must still fence money authority.
 */
export async function acquireGuardedOperatorLifecycleLock(
  administrator: GuardedOperatorAdministrator,
): Promise<GuardedOperatorLifecycleLock> {
  try {
    if (
      !administrator ||
      !Number.isInteger(administrator.processID) ||
      administrator.processID < 1 ||
      typeof administrator.query !== 'function' ||
      typeof administrator.on !== 'function' ||
      typeof administrator.off !== 'function'
    )
      throw new Error();
    const values = [LOCK_NAMESPACE, LOCK_OPERATION, administrator.processID];
    let rejectLost!: () => void;
    const lost = new Promise<never>((_, reject) => {
      rejectLost = () => reject(new GuardedOperatorLifecycleLockUnavailableError());
    });
    void lost.catch(() => undefined);
    let connectionLost = false;
    const onLoss = () => {
      connectionLost = true;
      rejectLost();
    };
    administrator.on('error', onLoss);
    administrator.on('end', onLoss);
    try {
      const acquired = await administrator.query(ACQUIRE_SQL, values);
      if (
        acquired.rows.length !== 1 ||
        acquired.rows[0] === null ||
        Object.keys(acquired.rows[0]!).length !== 1 ||
        acquired.rows[0]?.['acquired'] !== true ||
        connectionLost
      )
        throw new Error();
    } catch {
      administrator.off('error', onLoss);
      administrator.off('end', onLoss);
      throw new Error();
    }

    let released = false;
    return Object.freeze({
      lost,
      async release(): Promise<void> {
        if (released) throw new GuardedOperatorLifecycleLockUnavailableError();
        released = true;
        try {
          const result = await administrator.query(RELEASE_SQL, values);
          if (
            result.rows.length !== 1 ||
            result.rows[0] === null ||
            Object.keys(result.rows[0]!).length !== 1 ||
            result.rows[0]?.['released'] !== true
          )
            throw new Error();
        } catch {
          onLoss();
          throw new GuardedOperatorLifecycleLockUnavailableError();
        } finally {
          administrator.off('error', onLoss);
          administrator.off('end', onLoss);
        }
      },
    });
  } catch {
    throw new GuardedOperatorLifecycleLockUnavailableError();
  }
}
