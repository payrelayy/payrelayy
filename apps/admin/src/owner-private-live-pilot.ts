export type PrivateLivePilotStopReason =
  | 'cap_review'
  | 'execution_uncertainty'
  | 'owner_stop'
  | 'parser_drift'
  | 'pilot_complete'
  | 'provider_incident';

export interface PrepareApprovedPrivateLivePilotRequest {
  readonly activeFrom: Date;
  readonly expiresAt: Date;
  readonly playerIds: readonly [string, string, string, string, string];
  readonly requestId: string;
}

export interface PrivateLivePilotStatus {
  readonly configurationDigest: string;
  readonly contractVersion: 1;
  readonly expiresAt: string;
  readonly financiallyActive: boolean;
  readonly maximumAggregateMinor: string;
  readonly maximumReservationCount: number;
  readonly pilotRevisionId: string;
  readonly pilotStatus: 'armed' | 'draft' | 'stopped';
  readonly providerCount: number;
  readonly reservedAmountMinor: string;
  readonly reservedDepositCount: number;
  readonly revision: number;
  readonly stopReasonCode?: PrivateLivePilotStopReason;
  readonly stoppedAt?: string;
  readonly submittingCustomerCount: number;
  readonly switchMode: 'disabled' | 'dry_run' | 'live';
  readonly playerCount: number;
  readonly withinActiveWindow: boolean;
}

export interface PrivateLivePilotDatabase {
  query(
    sql: string,
    values: readonly (Date | number | readonly string[] | string)[],
  ): Promise<{ readonly rows: readonly unknown[] }>;
}

export class OwnerPrivateLivePilotRejectedError extends Error {
  constructor() {
    super('The Owner private live-deposit pilot operation was rejected.');
    this.name = 'OwnerPrivateLivePilotRejectedError';
  }
}

export class OwnerPrivateLivePilotUnavailableError extends Error {
  constructor() {
    super('The Owner private live-deposit pilot operation is unavailable.');
    this.name = 'OwnerPrivateLivePilotUnavailableError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PLAYER_ID_PATTERN =
  /^[^\s\u0000-\u001f\u007f](?:[^\u0000-\u001f\u007f]{0,62}[^\s\u0000-\u001f\u007f])?$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const STOP_REASONS = new Set<PrivateLivePilotStopReason>([
  'cap_review',
  'execution_uncertainty',
  'owner_stop',
  'parser_drift',
  'pilot_complete',
  'provider_incident',
]);

const PREPARE_SQL = `
  select app.prepare_approved_private_live_telebirr_pilot(
    $1::uuid,
    $2::uuid,
    $3::text[],
    $4::timestamptz,
    $5::timestamptz
  ) as pilot_revision_id
`;
const ARM_SQL = `select app.arm_companion_verified_private_live_telebirr_pilot($1::uuid, $2::uuid)`;
const STOP_SQL = `select app.stop_private_live_deposit_pilot($1::uuid, $2::uuid, $3::text)`;
const STATUS_SQL = `
  select pilot_revision_id,
         revision,
         contract_version,
         pilot_status,
         switch_mode,
         configuration_digest,
         financially_active,
         within_active_window,
         player_count,
         submitting_customer_count,
         provider_count,
         reserved_deposit_count,
         reserved_amount_minor,
         maximum_reservation_count,
         maximum_aggregate_minor,
         expires_at,
         stopped_at,
         stop_reason_code
    from app.get_private_live_deposit_pilot_status($1::uuid, $2::uuid)
`;
const CURRENT_STATUS_SQL = `
  select pilot_revision_id,
         revision,
         contract_version,
         pilot_status,
         switch_mode,
         configuration_digest,
         financially_active,
         within_active_window,
         player_count,
         submitting_customer_count,
         provider_count,
         reserved_deposit_count,
         reserved_amount_minor,
         maximum_reservation_count,
         maximum_aggregate_minor,
         expires_at,
         stopped_at,
         stop_reason_code
    from app.get_current_private_live_deposit_pilot_status($1::uuid)
`;

function databaseErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

function rowObject(row: unknown): Record<string, unknown> {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    throw new OwnerPrivateLivePilotUnavailableError();
  }
  return row as Record<string, unknown>;
}

function isoDate(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new OwnerPrivateLivePilotUnavailableError();
  }
  return value.toISOString();
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new OwnerPrivateLivePilotUnavailableError();
  }
  return Number(value);
}

function decimal(value: unknown): string {
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value)) {
    throw new OwnerPrivateLivePilotUnavailableError();
  }
  return value;
}

function validatePreparation(request: PrepareApprovedPrivateLivePilotRequest): void {
  const players = [...request.playerIds];
  if (
    !UUID_V4_PATTERN.test(request.requestId) ||
    players.length !== 5 ||
    new Set(players).size !== 5 ||
    players.some((playerId) => !PLAYER_ID_PATTERN.test(playerId)) ||
    !Number.isFinite(request.activeFrom.getTime()) ||
    !Number.isFinite(request.expiresAt.getTime()) ||
    request.expiresAt.getTime() !== request.activeFrom.getTime() + 2 * 60 * 60 * 1_000
  ) {
    throw new OwnerPrivateLivePilotRejectedError();
  }
}

function statusFromRows(
  rows: readonly unknown[],
  expectedPilotRevisionId: string,
): PrivateLivePilotStatus {
  const row = rows.length === 1 ? rowObject(rows[0]) : undefined;
  if (
    !row ||
    row.pilot_revision_id !== expectedPilotRevisionId ||
    row.contract_version !== 1 ||
    (row.pilot_status !== 'draft' &&
      row.pilot_status !== 'armed' &&
      row.pilot_status !== 'stopped') ||
    (row.switch_mode !== 'disabled' &&
      row.switch_mode !== 'dry_run' &&
      row.switch_mode !== 'live') ||
    typeof row.configuration_digest !== 'string' ||
    !DIGEST_PATTERN.test(row.configuration_digest) ||
    typeof row.financially_active !== 'boolean' ||
    typeof row.within_active_window !== 'boolean'
  ) {
    throw new OwnerPrivateLivePilotUnavailableError();
  }

  const stopped = row.pilot_status === 'stopped';
  if (
    (stopped &&
      (!(row.stopped_at instanceof Date) ||
        typeof row.stop_reason_code !== 'string' ||
        !STOP_REASONS.has(row.stop_reason_code as PrivateLivePilotStopReason))) ||
    (!stopped && (row.stopped_at !== null || row.stop_reason_code !== null)) ||
    (row.financially_active && (row.pilot_status !== 'armed' || row.switch_mode !== 'live')) ||
    (row.pilot_status === 'draft' && row.switch_mode !== 'disabled') ||
    (row.pilot_status === 'stopped' && row.switch_mode !== 'disabled')
  ) {
    throw new OwnerPrivateLivePilotUnavailableError();
  }

  const maximumAggregateMinor = decimal(row.maximum_aggregate_minor);
  const maximumReservationCount = boundedInteger(row.maximum_reservation_count, 1, 5);
  const playerCount = boundedInteger(row.player_count, 5, 5);
  const providerCount = boundedInteger(row.provider_count, 1, 2);
  const reservedAmountMinor = decimal(row.reserved_amount_minor);
  const reservedDepositCount = boundedInteger(row.reserved_deposit_count, 0, 5);
  const submittingCustomerCount = boundedInteger(row.submitting_customer_count, 1, 5);
  if (
    BigInt(maximumAggregateMinor) < 2_500n ||
    BigInt(maximumAggregateMinor) > 12_500_000n ||
    reservedDepositCount > maximumReservationCount ||
    BigInt(reservedAmountMinor) > BigInt(maximumAggregateMinor)
  ) {
    throw new OwnerPrivateLivePilotUnavailableError();
  }

  return {
    configurationDigest: row.configuration_digest,
    contractVersion: 1,
    expiresAt: isoDate(row.expires_at),
    financiallyActive: row.financially_active,
    maximumAggregateMinor,
    maximumReservationCount,
    pilotRevisionId: expectedPilotRevisionId,
    pilotStatus: row.pilot_status,
    playerCount,
    providerCount,
    reservedAmountMinor,
    reservedDepositCount,
    revision: boundedInteger(row.revision, 1, Number.MAX_SAFE_INTEGER),
    ...(stopped
      ? {
          stoppedAt: isoDate(row.stopped_at),
          stopReasonCode: row.stop_reason_code as PrivateLivePilotStopReason,
        }
      : {}),
    submittingCustomerCount,
    switchMode: row.switch_mode,
    withinActiveWindow: row.within_active_window,
  };
}

export class PostgresOwnerPrivateLivePilotControl {
  constructor(private readonly database: PrivateLivePilotDatabase) {}

  async prepare(
    authUserId: string,
    request: PrepareApprovedPrivateLivePilotRequest,
  ): Promise<PrivateLivePilotStatus> {
    if (!UUID_PATTERN.test(authUserId)) throw new OwnerPrivateLivePilotRejectedError();
    validatePreparation(request);

    try {
      const prepared = await this.database.query(PREPARE_SQL, [
        authUserId,
        request.requestId,
        [...request.playerIds],
        request.activeFrom,
        request.expiresAt,
      ]);
      const row = prepared.rows.length === 1 ? rowObject(prepared.rows[0]) : undefined;
      const pilotRevisionId = row?.pilot_revision_id;
      if (typeof pilotRevisionId !== 'string' || !UUID_PATTERN.test(pilotRevisionId)) {
        throw new OwnerPrivateLivePilotUnavailableError();
      }
      return await this.status(authUserId, pilotRevisionId);
    } catch (error) {
      if (
        error instanceof OwnerPrivateLivePilotRejectedError ||
        error instanceof OwnerPrivateLivePilotUnavailableError
      ) {
        throw error;
      }
      if (databaseErrorCode(error) === 'P0001' || databaseErrorCode(error) === '23505') {
        throw new OwnerPrivateLivePilotRejectedError();
      }
      throw new OwnerPrivateLivePilotUnavailableError();
    }
  }

  async current(authUserId: string): Promise<PrivateLivePilotStatus | undefined> {
    if (!UUID_PATTERN.test(authUserId)) throw new OwnerPrivateLivePilotRejectedError();
    try {
      const result = await this.database.query(CURRENT_STATUS_SQL, [authUserId]);
      if (result.rows.length === 0) return undefined;
      const row = result.rows.length === 1 ? rowObject(result.rows[0]) : undefined;
      if (!row || typeof row.pilot_revision_id !== 'string') {
        throw new OwnerPrivateLivePilotUnavailableError();
      }
      return statusFromRows(result.rows, row.pilot_revision_id);
    } catch (error) {
      if (
        error instanceof OwnerPrivateLivePilotRejectedError ||
        error instanceof OwnerPrivateLivePilotUnavailableError
      ) {
        throw error;
      }
      if (databaseErrorCode(error) === 'P0001') {
        throw new OwnerPrivateLivePilotRejectedError();
      }
      throw new OwnerPrivateLivePilotUnavailableError();
    }
  }

  async arm(
    authUserId: string,
    pilotRevisionId: string,
  ): Promise<{ readonly alreadyApplied: boolean; readonly status: PrivateLivePilotStatus }> {
    if (!UUID_PATTERN.test(authUserId) || !UUID_PATTERN.test(pilotRevisionId)) {
      throw new OwnerPrivateLivePilotRejectedError();
    }

    const before = await this.status(authUserId, pilotRevisionId);
    if (before.pilotStatus === 'armed') {
      if (before.switchMode !== 'dry_run' || before.financiallyActive) {
        throw new OwnerPrivateLivePilotUnavailableError();
      }
      return { alreadyApplied: true, status: before };
    }
    if (before.pilotStatus !== 'draft') throw new OwnerPrivateLivePilotRejectedError();

    try {
      await this.database.query(ARM_SQL, [authUserId, pilotRevisionId]);
    } catch (error) {
      if (databaseErrorCode(error) === 'P0001') {
        const concurrent = await this.status(authUserId, pilotRevisionId);
        if (concurrent.pilotStatus === 'armed') {
          if (concurrent.switchMode !== 'dry_run' || concurrent.financiallyActive) {
            throw new OwnerPrivateLivePilotUnavailableError();
          }
          return { alreadyApplied: true, status: concurrent };
        }
        throw new OwnerPrivateLivePilotRejectedError();
      }
      throw new OwnerPrivateLivePilotUnavailableError();
    }

    const status = await this.status(authUserId, pilotRevisionId);
    if (
      status.pilotStatus !== 'armed' ||
      status.switchMode !== 'dry_run' ||
      status.financiallyActive
    ) {
      throw new OwnerPrivateLivePilotUnavailableError();
    }
    return { alreadyApplied: false, status };
  }

  async stop(
    authUserId: string,
    pilotRevisionId: string,
    reasonCode: PrivateLivePilotStopReason,
  ): Promise<PrivateLivePilotStatus> {
    if (
      !UUID_PATTERN.test(authUserId) ||
      !UUID_PATTERN.test(pilotRevisionId) ||
      !STOP_REASONS.has(reasonCode)
    ) {
      throw new OwnerPrivateLivePilotRejectedError();
    }

    try {
      // The emergency stop is intentionally attempted before any read-side status dependency.
      await this.database.query(STOP_SQL, [authUserId, pilotRevisionId, reasonCode]);
      const status = await this.status(authUserId, pilotRevisionId);
      if (
        status.pilotStatus !== 'stopped' ||
        status.switchMode !== 'disabled' ||
        status.financiallyActive ||
        status.stopReasonCode !== reasonCode
      ) {
        throw new OwnerPrivateLivePilotUnavailableError();
      }
      return status;
    } catch (error) {
      if (
        error instanceof OwnerPrivateLivePilotRejectedError ||
        error instanceof OwnerPrivateLivePilotUnavailableError
      ) {
        throw error;
      }
      if (databaseErrorCode(error) === 'P0001') {
        throw new OwnerPrivateLivePilotRejectedError();
      }
      throw new OwnerPrivateLivePilotUnavailableError();
    }
  }

  async status(authUserId: string, pilotRevisionId: string): Promise<PrivateLivePilotStatus> {
    if (!UUID_PATTERN.test(authUserId) || !UUID_PATTERN.test(pilotRevisionId)) {
      throw new OwnerPrivateLivePilotRejectedError();
    }
    try {
      const result = await this.database.query(STATUS_SQL, [authUserId, pilotRevisionId]);
      return statusFromRows(result.rows, pilotRevisionId);
    } catch (error) {
      if (
        error instanceof OwnerPrivateLivePilotRejectedError ||
        error instanceof OwnerPrivateLivePilotUnavailableError
      ) {
        throw error;
      }
      if (databaseErrorCode(error) === 'P0001') {
        throw new OwnerPrivateLivePilotRejectedError();
      }
      throw new OwnerPrivateLivePilotUnavailableError();
    }
  }
}
