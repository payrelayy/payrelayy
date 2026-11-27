export class OwnerBusinessAnalyticsRejectedError extends Error {}
export class OwnerBusinessAnalyticsUnavailableError extends Error {}

interface OwnerAnalyticsDatabase {
  query(
    sql: string,
    values: readonly (string | number | null)[],
  ): Promise<{ readonly rows: readonly unknown[] }>;
}

export interface OwnerBusinessPeriod {
  readonly newUsers: number;
  readonly automaticCredits: number;
  readonly automaticAmountMinor: string;
  readonly manualRecords: number;
  readonly manualRecordedAmountMinor: string;
}

export interface OwnerBusinessMetrics {
  readonly checkedAt: string;
  readonly timeZone: 'Africa/Addis_Ababa';
  readonly registeredUsers: number;
  readonly today: OwnerBusinessPeriod;
  readonly week: OwnerBusinessPeriod;
  readonly month: OwnerBusinessPeriod;
}

export interface OwnerTelegramUser {
  readonly telegramId: string;
  readonly status: 'active' | 'inactive' | 'blocked' | 'archived';
  readonly joinedAt: string;
  readonly lastActiveAt: string | null;
  readonly playerCount: number;
  readonly playerIds: readonly string[];
  readonly automaticCredits: number;
  readonly automaticAmountMinor: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TELEGRAM_ID = /^[1-9][0-9]{0,19}$/u;
const NONNEGATIVE_INTEGER = /^(0|[1-9][0-9]*)$/u;
const PLAYER_ID = /^[^\s\u0000-\u001f\u007f]{1,64}$/u;

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new OwnerBusinessAnalyticsUnavailableError();
  return value as Record<string, unknown>;
}

function count(value: unknown): number {
  const parsed =
    typeof value === 'string' && NONNEGATIVE_INTEGER.test(value) ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0)
    throw new OwnerBusinessAnalyticsUnavailableError();
  return parsed;
}

function amount(value: unknown): string {
  if (typeof value !== 'string' || !NONNEGATIVE_INTEGER.test(value))
    throw new OwnerBusinessAnalyticsUnavailableError();
  return value;
}

function timestamp(value: unknown, optional = false): string | null {
  if (optional && value === null) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === 'string' && Number.isFinite(Date.parse(value)))
    return new Date(value).toISOString();
  throw new OwnerBusinessAnalyticsUnavailableError();
}

function period(value: unknown): OwnerBusinessPeriod {
  const row = object(value);
  return {
    newUsers: count(row.newUsers),
    automaticCredits: count(row.automaticCredits),
    automaticAmountMinor: amount(row.automaticAmountMinor),
    manualRecords: count(row.manualRecords),
    manualRecordedAmountMinor: amount(row.manualRecordedAmountMinor),
  };
}

export class PostgresOwnerBusinessAnalytics {
  constructor(private readonly database: OwnerAnalyticsDatabase) {}

  async metrics(actor: string): Promise<OwnerBusinessMetrics> {
    if (!UUID.test(actor)) throw new OwnerBusinessAnalyticsRejectedError();
    try {
      const result = await this.database.query(
        'select app.get_owner_business_metrics($1::uuid) as metrics',
        [actor],
      );
      if (result.rows.length !== 1) throw new OwnerBusinessAnalyticsUnavailableError();
      const value = object(object(result.rows[0]).metrics);
      if (value.timeZone !== 'Africa/Addis_Ababa')
        throw new OwnerBusinessAnalyticsUnavailableError();
      const metrics: OwnerBusinessMetrics = {
        checkedAt: timestamp(value.checkedAt)!,
        timeZone: 'Africa/Addis_Ababa',
        registeredUsers: count(value.registeredUsers),
        today: period(value.today),
        week: period(value.week),
        month: period(value.month),
      };
      if (
        metrics.today.newUsers > metrics.registeredUsers ||
        metrics.week.newUsers > metrics.registeredUsers ||
        metrics.month.newUsers > metrics.registeredUsers ||
        metrics.today.newUsers > metrics.week.newUsers ||
        metrics.today.newUsers > metrics.month.newUsers
      )
        throw new OwnerBusinessAnalyticsUnavailableError();
      return metrics;
    } catch (error) {
      if (error instanceof OwnerBusinessAnalyticsUnavailableError) throw error;
      throw new OwnerBusinessAnalyticsUnavailableError();
    }
  }

  async listUsers(
    actor: string,
    telegramId: string | null,
    limit = 25,
    offset = 0,
  ): Promise<readonly OwnerTelegramUser[]> {
    if (
      !UUID.test(actor) ||
      (telegramId !== null && !TELEGRAM_ID.test(telegramId)) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 51 ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > 10000
    )
      throw new OwnerBusinessAnalyticsRejectedError();
    try {
      const result = await this.database.query(
        `select telegram_user_id, identity_status, joined_at, last_active_at,
                player_count, player_ids, automatic_credits, automatic_amount_minor
           from app.list_owner_telegram_users($1::uuid,$2::text,$3::integer,$4::integer)`,
        [actor, telegramId, limit, offset],
      );
      if (result.rows.length > limit) throw new OwnerBusinessAnalyticsUnavailableError();
      return result.rows.map((raw) => {
        const row = object(raw);
        if (
          typeof row.telegram_user_id !== 'string' ||
          !TELEGRAM_ID.test(row.telegram_user_id) ||
          !['active', 'inactive', 'blocked', 'archived'].includes(String(row.identity_status)) ||
          !Array.isArray(row.player_ids) ||
          row.player_ids.length > 5 ||
          !row.player_ids.every((id: unknown) => typeof id === 'string' && PLAYER_ID.test(id))
        )
          throw new OwnerBusinessAnalyticsUnavailableError();
        const playerCount = count(row.player_count);
        if (row.player_ids.length > playerCount) throw new OwnerBusinessAnalyticsUnavailableError();
        return {
          telegramId: row.telegram_user_id,
          status: row.identity_status as OwnerTelegramUser['status'],
          joinedAt: timestamp(row.joined_at)!,
          lastActiveAt: timestamp(row.last_active_at, true),
          playerCount,
          playerIds: row.player_ids as string[],
          automaticCredits: count(row.automatic_credits),
          automaticAmountMinor: amount(row.automatic_amount_minor),
        };
      });
    } catch (error) {
      if (error instanceof OwnerBusinessAnalyticsUnavailableError) throw error;
      throw new OwnerBusinessAnalyticsUnavailableError();
    }
  }
}
