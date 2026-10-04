export interface OwnerRoutineProcessingDatabase {
  query(sql: string, values: readonly string[]): Promise<{ readonly rows: readonly unknown[] }>;
}

export interface OwnerRoutineProcessingPolicy {
  readonly mode: 'routine_production';
  readonly version: 1;
  readonly provider: 'telebirr';
  readonly platformCode: 'kemerbet';
  readonly currencyCode: 'ETB';
  readonly minimumAmountMinor: 2500;
  readonly maximumAmountMinor: 2500000;
  readonly freshnessWindowSeconds: 3600;
  readonly playerScope: 'all_active_deposit_eligible';
  readonly playerOwnershipRequired: false;
  readonly dailyQuotaMinor: null;
  readonly successfulDepositQuota: null;
  readonly maxConcurrentDeposits: 1;
  readonly amountSource: 'official_receipt_settled_amount';
}

export interface OwnerRoutineProcessingStatus {
  readonly configurationState: 'not_configured' | 'authorized' | 'stopped';
  /** Saving the persistent business policy is not an execution activation. */
  readonly executionEnabled: false;
  readonly authorizationId: string | null;
  readonly revision: string | null;
  readonly platformAgentAccountId: string | null;
  readonly authorizedAt: string | null;
  readonly changedAt: string | null;
  readonly policy: OwnerRoutineProcessingPolicy | null;
}

export class OwnerRoutineProcessingRejectedError extends Error {
  constructor() {
    super('The routine processing request was rejected.');
  }
}
export class OwnerRoutineProcessingConflictError extends Error {
  constructor() {
    super('The routine processing configuration is not ready.');
  }
}
export class OwnerRoutineProcessingUnavailableError extends Error {
  constructor() {
    super('The routine processing configuration is unavailable.');
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REQUEST_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const POLICY: OwnerRoutineProcessingPolicy = Object.freeze({
  mode: 'routine_production',
  version: 1,
  provider: 'telebirr',
  platformCode: 'kemerbet',
  currencyCode: 'ETB',
  minimumAmountMinor: 2500,
  maximumAmountMinor: 2500000,
  freshnessWindowSeconds: 3600,
  playerScope: 'all_active_deposit_eligible',
  playerOwnershipRequired: false,
  dailyQuotaMinor: null,
  successfulDepositQuota: null,
  maxConcurrentDeposits: 1,
  amountSource: 'official_receipt_settled_amount',
});
const STATUS_KEYS = [
  'configurationState',
  'executionEnabled',
  'authorizationId',
  'revision',
  'platformAgentAccountId',
  'authorizedAt',
  'changedAt',
  'policy',
]
  .sort()
  .join(',');

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OwnerRoutineProcessingUnavailableError();
  }
  return value as Record<string, unknown>;
}

export function decodeOwnerRoutineProcessingStatus(value: unknown): OwnerRoutineProcessingStatus {
  const status = record(value);
  if (
    Object.keys(status).sort().join(',') !== STATUS_KEYS ||
    !['not_configured', 'authorized', 'stopped'].includes(String(status.configurationState)) ||
    status.executionEnabled !== false ||
    (status.changedAt !== null &&
      (typeof status.changedAt !== 'string' || !Number.isFinite(Date.parse(status.changedAt))))
  ) {
    throw new OwnerRoutineProcessingUnavailableError();
  }
  if (status.authorizationId === null) {
    if (
      status.configurationState === 'authorized' ||
      status.revision !== null ||
      status.platformAgentAccountId !== null ||
      status.authorizedAt !== null ||
      status.policy !== null ||
      (status.configurationState === 'stopped' && status.changedAt === null) ||
      (status.configurationState === 'not_configured' && status.changedAt !== null)
    ) {
      throw new OwnerRoutineProcessingUnavailableError();
    }
    return Object.freeze({
      configurationState: status.configurationState as 'not_configured' | 'stopped',
      executionEnabled: false,
      authorizationId: null,
      revision: null,
      platformAgentAccountId: null,
      authorizedAt: null,
      changedAt: status.changedAt as string | null,
      policy: null,
    });
  }
  const policy = record(status.policy);
  if (
    status.configurationState === 'not_configured' ||
    typeof status.authorizationId !== 'string' ||
    !UUID.test(status.authorizationId) ||
    typeof status.platformAgentAccountId !== 'string' ||
    !UUID.test(status.platformAgentAccountId) ||
    typeof status.revision !== 'string' ||
    !/^[1-9][0-9]{0,18}$/u.test(status.revision) ||
    BigInt(status.revision) > 9223372036854775807n ||
    typeof status.authorizedAt !== 'string' ||
    !Number.isFinite(Date.parse(status.authorizedAt)) ||
    typeof status.changedAt !== 'string' ||
    Date.parse(status.changedAt) < Date.parse(status.authorizedAt) ||
    Object.keys(policy).sort().join(',') !== Object.keys(POLICY).sort().join(',') ||
    Object.entries(POLICY).some(([key, expected]) => policy[key] !== expected)
  ) {
    throw new OwnerRoutineProcessingUnavailableError();
  }
  return Object.freeze({
    configurationState: status.configurationState as 'authorized' | 'stopped',
    executionEnabled: false,
    authorizationId: status.authorizationId,
    revision: status.revision,
    platformAgentAccountId: status.platformAgentAccountId,
    authorizedAt: status.authorizedAt,
    changedAt: status.changedAt,
    policy: POLICY,
  });
}

export class PostgresOwnerRoutineTelebirrProcessing {
  constructor(private readonly database: OwnerRoutineProcessingDatabase) {}

  private async query(
    sql: string,
    values: readonly string[],
  ): Promise<OwnerRoutineProcessingStatus> {
    try {
      const result = await this.database.query(sql, values);
      if (result.rows.length !== 1) throw new OwnerRoutineProcessingUnavailableError();
      return decodeOwnerRoutineProcessingStatus(record(result.rows[0]).configuration);
    } catch (error) {
      if (error instanceof OwnerRoutineProcessingUnavailableError) throw error;
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      if (code === '42501' || code === '22023') throw new OwnerRoutineProcessingRejectedError();
      if (code === 'P0001') throw new OwnerRoutineProcessingConflictError();
      throw new OwnerRoutineProcessingUnavailableError();
    }
  }

  get(authUserId: string): Promise<OwnerRoutineProcessingStatus> {
    if (!UUID.test(authUserId)) throw new OwnerRoutineProcessingRejectedError();
    return this.query(
      'select app.get_owner_routine_telebirr_processing($1::uuid) as configuration',
      [authUserId],
    );
  }

  save(
    authUserId: string,
    platformAgentAccountId: string,
    requestKey: string,
  ): Promise<OwnerRoutineProcessingStatus> {
    if (
      !UUID.test(authUserId) ||
      !UUID.test(platformAgentAccountId) ||
      !REQUEST_UUID.test(requestKey)
    ) {
      throw new OwnerRoutineProcessingRejectedError();
    }
    return this.query(
      'select app.save_owner_routine_telebirr_processing($1::uuid, $2::uuid, $3::uuid) as configuration',
      [authUserId, platformAgentAccountId, requestKey],
    );
  }

  stop(authUserId: string, requestKey: string): Promise<OwnerRoutineProcessingStatus> {
    if (!UUID.test(authUserId) || !REQUEST_UUID.test(requestKey))
      throw new OwnerRoutineProcessingRejectedError();
    return this.query(
      'select app.stop_owner_routine_telebirr_processing($1::uuid, $2::uuid) as configuration',
      [authUserId, requestKey],
    );
  }
}
