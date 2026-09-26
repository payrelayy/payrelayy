export interface OwnerCompanionExecutionReadiness {
  readonly readOnly: true;
  readonly identifiersRedacted: true;
  readonly activationAvailable: false;
  readonly pilotState: 'none' | 'draft' | 'armed' | 'stopped';
  readonly openJobs: number;
  readonly untouchedQueuedJobs: number;
  readonly cancelledUntouchedJobs: number;
  readonly openExecutionReviews: number;
  readonly customerResolutionPending: boolean;
  readonly financialSwitchesDisabled: boolean;
  readonly companionExecutionDisabled: boolean;
  readonly executionCapabilityDormant: boolean;
  readonly effectiveTrustedEpochAvailable: boolean;
  readonly nextAction:
    | 'safety_review'
    | 'queue_reconciliation'
    | 'customer_resolution_pending'
    | 'pilot_review'
    | 'trusted_activation_review'
    | 'release_and_owner_review';
}

export class OwnerCompanionExecutionReadinessRejectedError extends Error {}
export class OwnerCompanionExecutionReadinessUnavailableError extends Error {}

export const OWNER_COMPANION_EXECUTION_READINESS_SQL =
  'select app.get_owner_companion_execution_readiness($1::uuid) as readiness';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PILOT_STATES = new Set(['none', 'draft', 'armed', 'stopped']);
const NEXT_ACTIONS = new Set([
  'safety_review',
  'queue_reconciliation',
  'customer_resolution_pending',
  'pilot_review',
  'trusted_activation_review',
  'release_and_owner_review',
]);
const KEYS = [
  'activationAvailable',
  'cancelledUntouchedJobs',
  'companionExecutionDisabled',
  'customerResolutionPending',
  'effectiveTrustedEpochAvailable',
  'executionCapabilityDormant',
  'financialSwitchesDisabled',
  'identifiersRedacted',
  'nextAction',
  'openExecutionReviews',
  'openJobs',
  'pilotState',
  'readOnly',
  'untouchedQueuedJobs',
]
  .sort()
  .join(',');

export function parseOwnerCompanionExecutionReadiness(
  value: unknown,
): OwnerCompanionExecutionReadiness {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OwnerCompanionExecutionReadinessUnavailableError();
  }
  const status = value as Record<string, unknown>;
  const counts = [
    status.openJobs,
    status.untouchedQueuedJobs,
    status.cancelledUntouchedJobs,
    status.openExecutionReviews,
  ];
  if (
    Object.keys(status).sort().join(',') !== KEYS ||
    status.readOnly !== true ||
    status.identifiersRedacted !== true ||
    status.activationAvailable !== false ||
    !PILOT_STATES.has(String(status.pilotState)) ||
    !NEXT_ACTIONS.has(String(status.nextAction)) ||
    counts.some(
      (count) => !Number.isSafeInteger(count) || Number(count) < 0 || Number(count) > 2,
    ) ||
    typeof status.customerResolutionPending !== 'boolean' ||
    typeof status.financialSwitchesDisabled !== 'boolean' ||
    typeof status.companionExecutionDisabled !== 'boolean' ||
    typeof status.executionCapabilityDormant !== 'boolean' ||
    typeof status.effectiveTrustedEpochAvailable !== 'boolean' ||
    (status.customerResolutionPending &&
      (status.nextAction !== 'customer_resolution_pending' ||
        status.openExecutionReviews !== 1 ||
        status.openJobs !== 0))
  ) {
    throw new OwnerCompanionExecutionReadinessUnavailableError();
  }
  return status as unknown as OwnerCompanionExecutionReadiness;
}

export class PostgresOwnerCompanionExecutionReadiness {
  constructor(
    private readonly database: {
      query(sql: string, values: readonly string[]): Promise<{ readonly rows: readonly unknown[] }>;
    },
  ) {}

  async status(authUserId: string): Promise<OwnerCompanionExecutionReadiness> {
    if (!UUID_PATTERN.test(authUserId)) {
      throw new OwnerCompanionExecutionReadinessRejectedError();
    }
    try {
      const result = await this.database.query(OWNER_COMPANION_EXECUTION_READINESS_SQL, [
        authUserId,
      ]);
      if (result.rows.length !== 1) throw new OwnerCompanionExecutionReadinessUnavailableError();
      const row = result.rows[0];
      if (
        typeof row !== 'object' ||
        row === null ||
        Array.isArray(row) ||
        Object.keys(row).join(',') !== 'readiness'
      ) {
        throw new OwnerCompanionExecutionReadinessUnavailableError();
      }
      return parseOwnerCompanionExecutionReadiness((row as Record<string, unknown>).readiness);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '42501'
      ) {
        throw new OwnerCompanionExecutionReadinessRejectedError();
      }
      throw new OwnerCompanionExecutionReadinessUnavailableError();
    }
  }
}
