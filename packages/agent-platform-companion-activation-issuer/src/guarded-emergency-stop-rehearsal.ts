import type { GuardedCompanionOwnedChild } from './guarded-pre-permit-child.js';

const DATABASE_STOP_WAIT_MS = 90_000;
const HOST_STOP_WAIT_MS = 12_000;

export interface GuardedCompanionEmergencyStopRehearsalInputs {
  /** The exact owned child returned by the protected starter, never a PID lookup. */
  readonly child: GuardedCompanionOwnedChild;
  /** Runs the independently reviewed administrator-only emergency SQL once with its own deadline. */
  readonly disableDatabase: () => Promise<unknown>;
}

export interface GuardedCompanionEmergencyStopRehearsalResult {
  readonly databaseCredentialsAndSessionsRevoked: true;
  readonly financialAuthorityDisabled: true;
  readonly companionExecutionDisabled: true;
  readonly exactHostStopped: true;
  /** Neither stop establishes whether an in-flight provider action completed. */
  readonly providerOutcomeRequiresReconciliation: true;
}

export class GuardedCompanionEmergencyStopRehearsalUnavailableError extends Error {
  readonly requiresIndependentStopAndReconciliation = true;

  constructor() {
    super('The guarded companion emergency stop could not be confirmed.');
    this.name = 'GuardedCompanionEmergencyStopRehearsalUnavailableError';
  }
}

function exactFields(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}

function validDatabaseProof(value: unknown): boolean {
  if (
    !exactFields(value, [
      'schemaVersion',
      'operation',
      'deploymentTarget',
      'runtimeLogin',
      'companionExecution',
      'financialAuthority',
      'providerOutcomeRequiresReconciliation',
    ])
  ) {
    return false;
  }
  return (
    value.schemaVersion === 1 &&
    value.operation === 'companion_execution_emergency_disable' &&
    value.deploymentTarget === 'production' &&
    value.runtimeLogin === 'disabled' &&
    value.companionExecution === 'disabled' &&
    value.financialAuthority === 'disabled' &&
    value.providerOutcomeRequiresReconciliation === true
  );
}

function validHostProof(value: unknown): boolean {
  return (
    exactFields(value, ['processStopped', 'providerOutcomeRequiresReconciliation']) &&
    value.processStopped === true &&
    value.providerOutcomeRequiresReconciliation === true
  );
}

async function bounded<T>(task: () => Promise<T>, deadlineMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(task),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error()), deadlineMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Source-only rehearsal of two independent stops. Both are started once even if
 * the other fails, throws synchronously, or times out. The database callback
 * must execute the reviewed emergency SQL with its own protected connection;
 * its fixed result is accepted only after that script commits and drains
 * sessions. The exact child must acknowledge and exit cleanly. No failure is
 * retried, and even a confirmed pair of stops never resolves provider outcome.
 * The bounded wait does not cancel an external SQL process; its adapter must
 * enforce its own deadline. This operator-only subpath is not wired to a
 * production entry point or to the package's root exports.
 */
export function prepareGuardedCompanionEmergencyStopRehearsal(
  input: GuardedCompanionEmergencyStopRehearsalInputs,
): () => Promise<GuardedCompanionEmergencyStopRehearsalResult> {
  try {
    if (
      !input ||
      !Number.isInteger(input.child?.processId) ||
      input.child.processId < 1 ||
      typeof input.child.stopAfterPermit !== 'function' ||
      typeof input.child.stopped?.then !== 'function' ||
      typeof input.disableDatabase !== 'function'
    ) {
      throw new Error();
    }
  } catch {
    throw new GuardedCompanionEmergencyStopRehearsalUnavailableError();
  }

  let spent = false;
  return async () => {
    if (spent) throw new GuardedCompanionEmergencyStopRehearsalUnavailableError();
    spent = true;

    const database = bounded(input.disableDatabase, DATABASE_STOP_WAIT_MS);
    const host = bounded(async () => {
      const proof = await input.child.stopAfterPermit();
      await input.child.stopped;
      return proof;
    }, HOST_STOP_WAIT_MS);
    const [databaseResult, hostResult] = await Promise.allSettled([database, host]);
    try {
      if (
        databaseResult.status !== 'fulfilled' ||
        !validDatabaseProof(databaseResult.value) ||
        hostResult.status !== 'fulfilled' ||
        !validHostProof(hostResult.value)
      ) {
        throw new Error();
      }
    } catch {
      // SQL/process errors can contain credentials or identifiers; never relay them.
      throw new GuardedCompanionEmergencyStopRehearsalUnavailableError();
    }
    return Object.freeze({
      databaseCredentialsAndSessionsRevoked: true,
      financialAuthorityDisabled: true,
      companionExecutionDisabled: true,
      exactHostStopped: true,
      providerOutcomeRequiresReconciliation: true,
    });
  };
}
