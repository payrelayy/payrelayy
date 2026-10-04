import {
  acquireGuardedOperatorLifecycleLock,
  type GuardedOperatorAdministrator,
} from '@fetanagent/agent-platform-companion-activation-issuer/guarded-operator-lifecycle-lock';

export const OPERATOR_BACKEND_SQL = 'select pg_catalog.pg_backend_pid() as backend_pid';

export type LifecycleConnectionDiagnosticPhase =
  'ready' | 'backend_binding' | 'lifecycle_lock' | 'lifecycle_lock_release';

/**
 * Caller supplies the existing protected connection inside BEGIN READ ONLY.
 * Probe the exact first operator query and release its session-only lock once.
 * No request, attestation, approval, queue operation, or financial transition
 * is available here. The caller must close the connection even after failure.
 */
export async function inspectLifecycleConnection(
  connection: Omit<GuardedOperatorAdministrator, 'processID'>,
): Promise<LifecycleConnectionDiagnosticPhase> {
  let phase: LifecycleConnectionDiagnosticPhase = 'backend_binding';
  try {
    const backend = await connection.query(OPERATOR_BACKEND_SQL, []);
    const processID: unknown = backend.rows[0]?.['backend_pid'];
    if (backend.rows.length !== 1 || !Number.isInteger(processID) || (processID as number) < 1)
      throw new Error();
    phase = 'lifecycle_lock';
    const lock = await acquireGuardedOperatorLifecycleLock({
      processID: processID as number,
      query: (sql, values) => connection.query(sql, values),
      on: (event, listener) => connection.on(event, listener),
      off: (event, listener) => connection.off(event, listener),
    });
    phase = 'lifecycle_lock_release';
    await lock.release();
    return 'ready';
  } catch {
    return phase;
  }
}
