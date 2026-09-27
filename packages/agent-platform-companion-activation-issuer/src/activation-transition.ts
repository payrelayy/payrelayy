import { COMPANION_EXECUTION_MAX_DATABASE_ACTIVATION_LIFETIME_MS } from '@fetanagent/agent-platform-companion-execution-contracts';

import type { CompanionActivationSnapshotQuery } from './snapshot.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RUNTIME_PASSWORD = /^[0-9a-f]{64}$/u;

export const ACTIVATE_SQL = `select app.activate_agent_platform_companion_execution_once(
  $1::uuid, $2::uuid, $3::text
) as valid_until`;

export interface CompanionActivationTransitionInput {
  readonly actorAuthUserId: string;
  readonly requestKey: string;
  /** Fresh, protected 32-byte random value encoded as lowercase hex. Never log it. */
  readonly runtimePassword: string;
}

/** An already-authenticated, short-lived postgres administrator session. */
export type CompanionActivationTransitionQuery = CompanionActivationSnapshotQuery;

export class CompanionActivationTransitionUnavailableError extends Error {
  constructor() {
    super('The companion activation transition input is unavailable.');
    this.name = 'CompanionActivationTransitionUnavailableError';
  }
}

/** A query may have committed even if its response was lost. Never retry it. */
export class CompanionActivationTransitionUncertainError extends Error {
  readonly requiresIndependentStopAndReconciliation = true;

  constructor() {
    super('The companion activation transition result is uncertain; stop and reconcile.');
    this.name = 'CompanionActivationTransitionUncertainError';
  }
}

function validInput(input: CompanionActivationTransitionInput): boolean {
  if (input === null || typeof input !== 'object') return false;
  const keys = Object.keys(input);
  return (
    keys.length === 3 &&
    keys.includes('actorAuthUserId') &&
    keys.includes('requestKey') &&
    keys.includes('runtimePassword') &&
    UUID_V4.test(input.actorAuthUserId) &&
    UUID_V4.test(input.requestKey) &&
    RUNTIME_PASSWORD.test(input.runtimePassword)
  );
}

/**
 * Internal source-only adapter for the already-reviewed database transition.
 * Deliberately absent from package exports and all production entry points until
 * an independently rehearsed host stop, credential revocation, and provider
 * reconciliation coordinator owns the full lifecycle. The database function
 * itself rechecks and consumes the one-use authority in one transaction.
 *
 * The caller must use a dedicated administrator connection with a short query
 * deadline and the production lifecycle lock. Any error after dispatch, even a
 * malformed result, is an uncertain activation: stop and reconcile, never retry.
 */
export async function invokeCompanionActivationTransitionInternal(
  input: CompanionActivationTransitionInput,
  administrator: CompanionActivationTransitionQuery,
): Promise<string> {
  let ready = false;
  try {
    ready = validInput(input) && !!administrator && typeof administrator.query === 'function';
  } catch {
    // Malformed operator inputs must not surface sensitive property values.
  }
  if (!ready) {
    throw new CompanionActivationTransitionUnavailableError();
  }

  try {
    const dispatchedAt = Date.now();
    const result = await administrator.query(ACTIVATE_SQL, [
      input.actorAuthUserId,
      input.requestKey,
      input.runtimePassword,
    ]);
    if (result.rows.length !== 1) throw new Error();
    const row = result.rows[0];
    if (!row || Object.keys(row).length !== 1 || !(row['valid_until'] instanceof Date)) {
      throw new Error();
    }
    const expiry = row['valid_until'].getTime();
    if (
      !Number.isFinite(expiry) ||
      expiry <= Date.now() ||
      expiry > dispatchedAt + COMPANION_EXECUTION_MAX_DATABASE_ACTIVATION_LIFETIME_MS + 30_000
    ) {
      throw new Error();
    }
    return row['valid_until'].toISOString();
  } catch {
    // Deliberately discard the database error: it may contain the query values.
    // A transport failure after commit is indistinguishable from a failed call.
    throw new CompanionActivationTransitionUncertainError();
  }
}
