export type OwnerPlayerDepositEligibilityDecision = 'eligible' | 'revoked';

export interface OwnerPlayerDepositEligibilityDatabase {
  query(
    sql: string,
    values: readonly (number | string)[],
  ): Promise<{ readonly rows: readonly unknown[] }>;
}

export interface OwnerPlayerDepositEligibilityRecord {
  readonly decidedAt?: string;
  readonly decision?: OwnerPlayerDepositEligibilityDecision;
  readonly decisionId?: string;
  readonly decisionVersion?: number;
  readonly playerAccountId: string;
  readonly playerId: string;
  readonly playerStatus: 'active' | 'inactive' | 'blocked' | 'archived';
  readonly platformCode: 'kemerbet';
  readonly reasonCode?: 'financial_eligibility_approved' | 'financial_eligibility_revoked';
  readonly validationStatus: 'unverified' | 'valid' | 'invalid' | 'review_required';
}

export interface OwnerPlayerDepositEligibilityReceipt {
  readonly alreadyRecorded: boolean;
  readonly decidedAt: string;
  readonly decision: OwnerPlayerDepositEligibilityDecision;
  readonly decisionId: string;
  readonly decisionVersion: number;
  readonly playerAccountId: string;
  readonly reasonCode: 'financial_eligibility_approved' | 'financial_eligibility_revoked';
}

export class OwnerPlayerDepositEligibilityRejectedError extends Error {
  constructor() {
    super('The Owner Player-ID deposit-eligibility operation was rejected.');
    this.name = 'OwnerPlayerDepositEligibilityRejectedError';
  }
}

export class OwnerPlayerDepositEligibilityUnavailableError extends Error {
  constructor() {
    super('The Owner Player-ID deposit-eligibility operation is unavailable.');
    this.name = 'OwnerPlayerDepositEligibilityUnavailableError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PLAYER_ID_PATTERN = /^[^\s\u0000-\u001f\u007f]{1,64}$/u;
const PLAYER_STATUSES = new Set(['active', 'inactive', 'blocked', 'archived']);
const VALIDATION_STATUSES = new Set(['unverified', 'valid', 'invalid', 'review_required']);
const REASONS = {
  eligible: 'financial_eligibility_approved',
  revoked: 'financial_eligibility_revoked',
} as const;

const LIST_SQL = `
  select player_account_id,
         platform_code,
         player_id,
         player_status,
         validation_status,
         decision_id,
         decision_version,
         decision,
         reason_code,
         decided_at
  from app.list_owner_player_deposit_eligibility($1::uuid, $2::integer)
`;

const DECIDE_SQL = `
  select decided_player_account_id,
         decided_decision_id,
         decided_version,
         decided_decision,
         decided_reason_code,
         decided_at,
         decision_already_recorded
  from app.decide_owner_player_deposit_eligibility($1::uuid, $2::uuid, $3::text, $4::text)
`;

function databaseErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

function rowObject(row: unknown): Record<string, unknown> {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    throw new OwnerPlayerDepositEligibilityUnavailableError();
  }
  return row as Record<string, unknown>;
}

function isoDate(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new OwnerPlayerDepositEligibilityUnavailableError();
  }
  return value.toISOString();
}

export class PostgresOwnerPlayerDepositEligibility {
  constructor(private readonly database: OwnerPlayerDepositEligibilityDatabase) {}

  async list(
    authUserId: string,
    limit = 50,
  ): Promise<readonly OwnerPlayerDepositEligibilityRecord[]> {
    if (!UUID_PATTERN.test(authUserId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new OwnerPlayerDepositEligibilityRejectedError();
    }

    try {
      const result = await this.database.query(LIST_SQL, [authUserId, limit]);
      if (result.rows.length > limit) throw new OwnerPlayerDepositEligibilityUnavailableError();
      return result.rows.map((rawRow) => {
        const row = rowObject(rawRow);
        if (
          typeof row.player_account_id !== 'string' ||
          !UUID_PATTERN.test(row.player_account_id) ||
          row.platform_code !== 'kemerbet' ||
          typeof row.player_id !== 'string' ||
          !PLAYER_ID_PATTERN.test(row.player_id) ||
          typeof row.player_status !== 'string' ||
          !PLAYER_STATUSES.has(row.player_status) ||
          typeof row.validation_status !== 'string' ||
          !VALIDATION_STATUSES.has(row.validation_status)
        ) {
          throw new OwnerPlayerDepositEligibilityUnavailableError();
        }

        const hasNoDecision =
          row.decision_id === null &&
          row.decision_version === null &&
          row.decision === null &&
          row.reason_code === null &&
          row.decided_at === null;
        if (hasNoDecision) {
          return {
            playerAccountId: row.player_account_id,
            playerId: row.player_id,
            playerStatus: row.player_status as OwnerPlayerDepositEligibilityRecord['playerStatus'],
            platformCode: 'kemerbet' as const,
            validationStatus:
              row.validation_status as OwnerPlayerDepositEligibilityRecord['validationStatus'],
          };
        }

        if (
          typeof row.decision_id !== 'string' ||
          !UUID_PATTERN.test(row.decision_id) ||
          !Number.isSafeInteger(row.decision_version) ||
          Number(row.decision_version) < 1 ||
          (row.decision !== 'eligible' && row.decision !== 'revoked')
        ) {
          throw new OwnerPlayerDepositEligibilityUnavailableError();
        }
        const reasonCode = REASONS[row.decision];
        if (row.reason_code !== reasonCode) {
          throw new OwnerPlayerDepositEligibilityUnavailableError();
        }

        return {
          decidedAt: isoDate(row.decided_at),
          decision: row.decision,
          decisionId: row.decision_id,
          decisionVersion: row.decision_version as number,
          playerAccountId: row.player_account_id,
          playerId: row.player_id,
          playerStatus: row.player_status as OwnerPlayerDepositEligibilityRecord['playerStatus'],
          platformCode: 'kemerbet' as const,
          reasonCode,
          validationStatus:
            row.validation_status as OwnerPlayerDepositEligibilityRecord['validationStatus'],
        };
      });
    } catch (error) {
      if (error instanceof OwnerPlayerDepositEligibilityUnavailableError) throw error;
      if (databaseErrorCode(error) === 'P0001') {
        throw new OwnerPlayerDepositEligibilityRejectedError();
      }
      throw new OwnerPlayerDepositEligibilityUnavailableError();
    }
  }

  async decide(
    authUserId: string,
    playerAccountId: string,
    decision: OwnerPlayerDepositEligibilityDecision,
  ): Promise<OwnerPlayerDepositEligibilityReceipt> {
    if (
      !UUID_PATTERN.test(authUserId) ||
      !UUID_PATTERN.test(playerAccountId) ||
      !(decision in REASONS)
    ) {
      throw new OwnerPlayerDepositEligibilityRejectedError();
    }

    try {
      const result = await this.database.query(DECIDE_SQL, [
        authUserId,
        playerAccountId,
        decision,
        REASONS[decision],
      ]);
      const row = result.rows.length === 1 ? rowObject(result.rows[0]) : undefined;
      if (
        !row ||
        row.decided_player_account_id !== playerAccountId ||
        typeof row.decided_decision_id !== 'string' ||
        !UUID_PATTERN.test(row.decided_decision_id) ||
        !Number.isSafeInteger(row.decided_version) ||
        Number(row.decided_version) < 1 ||
        row.decided_decision !== decision ||
        row.decided_reason_code !== REASONS[decision] ||
        typeof row.decision_already_recorded !== 'boolean'
      ) {
        throw new OwnerPlayerDepositEligibilityUnavailableError();
      }

      return {
        alreadyRecorded: row.decision_already_recorded,
        decidedAt: isoDate(row.decided_at),
        decision,
        decisionId: row.decided_decision_id,
        decisionVersion: row.decided_version as number,
        playerAccountId,
        reasonCode: REASONS[decision],
      };
    } catch (error) {
      if (error instanceof OwnerPlayerDepositEligibilityUnavailableError) throw error;
      if (databaseErrorCode(error) === 'P0001' || databaseErrorCode(error) === '23505') {
        throw new OwnerPlayerDepositEligibilityRejectedError();
      }
      throw new OwnerPlayerDepositEligibilityUnavailableError();
    }
  }
}
