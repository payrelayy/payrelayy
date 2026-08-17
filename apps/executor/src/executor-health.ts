const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export type KemerBetExecutorCircuitReason =
  'cancelled_before_action' | 'needs_attention' | 'recovery_circuit_open' | 'startup_failed';

export type KemerBetExecutorReadinessFailure =
  | 'circuit_open'
  | 'database_unavailable'
  | 'session_unavailable'
  | 'sessions_not_configured'
  | 'stopping';

export interface KemerBetExecutorSessionReadiness {
  readonly ready: boolean;
  readonly reason:
    | 'ready'
    | 'invalid_account_id'
    | 'profile_missing'
    | 'unsafe_profile'
    | 'registry_closed'
    | 'authenticated_session_unavailable';
}

export interface KemerBetExecutorHealthDependencies {
  readonly platformAgentAccountIds: readonly string[];
  readonly probeDatabase: () => Promise<boolean>;
  readonly probeSessionReadiness: (
    platformAgentAccountId: string,
  ) => Promise<KemerBetExecutorSessionReadiness>;
}

export type KemerBetExecutorReadiness =
  | {
      readonly ready: true;
      readonly status: 'ready';
      readonly service: 'fetanagent-executor';
    }
  | {
      readonly ready: false;
      readonly status: 'unavailable';
      readonly service: 'fetanagent-executor';
      readonly reason: KemerBetExecutorReadinessFailure;
    };

export interface KemerBetExecutorHealth {
  healthz(): {
    readonly status: 'ok';
    readonly service: 'fetanagent-executor';
  };
  readyz(): Promise<KemerBetExecutorReadiness>;
  openCircuit(reason: KemerBetExecutorCircuitReason): void;
  circuitReason(): KemerBetExecutorCircuitReason | null;
  markStopping(): void;
}

function unavailable(reason: KemerBetExecutorReadinessFailure): KemerBetExecutorReadiness {
  return Object.freeze({
    ready: false as const,
    status: 'unavailable' as const,
    service: 'fetanagent-executor' as const,
    reason,
  });
}

function exactAccountIds(values: readonly string[]): readonly string[] {
  if (
    values.length === 0 ||
    values.some(
      (value) => !UUID_PATTERN.test(value) || value === '00000000-0000-0000-0000-000000000000',
    ) ||
    new Set(values).size !== values.length
  ) {
    return [];
  }
  return Object.freeze([...values]);
}

export function createKemerBetExecutorHealth(
  dependencies: KemerBetExecutorHealthDependencies,
): KemerBetExecutorHealth {
  const accountIds = exactAccountIds(dependencies.platformAgentAccountIds);
  let circuit: KemerBetExecutorCircuitReason | null = null;
  let stopping = false;
  let readinessInFlight: Promise<KemerBetExecutorReadiness> | null = null;

  async function probeReadiness(): Promise<KemerBetExecutorReadiness> {
    if (stopping) return unavailable('stopping');
    if (circuit !== null) return unavailable('circuit_open');
    if (accountIds.length === 0) return unavailable('sessions_not_configured');

    let databaseReady: boolean;
    try {
      databaseReady = (await dependencies.probeDatabase()) === true;
    } catch {
      databaseReady = false;
    }
    if (!databaseReady) return unavailable('database_unavailable');

    let allSessionsReady = true;
    // Launching and probing persistent authenticated profiles is deliberately serialized. This
    // prevents concurrent Chromium/session work and still checks every configured account.
    for (const accountId of accountIds) {
      try {
        const result = await dependencies.probeSessionReadiness(accountId);
        if (result.ready !== true || result.reason !== 'ready') allSessionsReady = false;
      } catch {
        allSessionsReady = false;
      }
    }
    if (!allSessionsReady) return unavailable('session_unavailable');
    if (stopping) return unavailable('stopping');
    if (circuit !== null) return unavailable('circuit_open');

    return Object.freeze({
      ready: true as const,
      status: 'ready' as const,
      service: 'fetanagent-executor' as const,
    });
  }

  return {
    healthz: () => Object.freeze({ status: 'ok', service: 'fetanagent-executor' }),

    readyz() {
      if (readinessInFlight !== null) return readinessInFlight;
      const pending = probeReadiness().finally(() => {
        if (readinessInFlight === pending) readinessInFlight = null;
      });
      readinessInFlight = pending;
      return pending;
    },

    openCircuit(reason) {
      circuit ??= reason;
    },

    circuitReason: () => circuit,

    markStopping() {
      stopping = true;
    },
  };
}
