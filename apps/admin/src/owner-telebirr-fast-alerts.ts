export interface OwnerTelebirrFastAlertsDatabase {
  query(sql: string, values: readonly string[]): Promise<{ readonly rows: readonly unknown[] }>;
}

export interface OwnerTelebirrFastAlertSummary {
  readonly heldCount: number;
  readonly receiptLayoutChanged: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class OwnerTelebirrFastAlertsUnavailableError extends Error {
  constructor() {
    super('Owner TeleBirr alert summary is unavailable.');
    this.name = 'OwnerTelebirrFastAlertsUnavailableError';
  }
}

export class PostgresOwnerTelebirrFastAlerts {
  constructor(private readonly database: OwnerTelebirrFastAlertsDatabase) {}

  async status(authUserId: string): Promise<OwnerTelebirrFastAlertSummary> {
    if (!UUID.test(authUserId)) throw new OwnerTelebirrFastAlertsUnavailableError();
    try {
      const result = await this.database.query(
        'select * from app.get_owner_routine_telebirr_fast_alert_summary($1::uuid)',
        [authUserId],
      );
      if (result.rows.length !== 1) throw new OwnerTelebirrFastAlertsUnavailableError();
      const row = result.rows[0];
      if (typeof row !== 'object' || row === null || Array.isArray(row))
        throw new OwnerTelebirrFastAlertsUnavailableError();
      const value = row as Record<string, unknown>;
      if (
        Object.keys(value).length !== 2 ||
        typeof value.held_count !== 'string' ||
        !/^[0-9]+$/u.test(value.held_count) ||
        BigInt(value.held_count) > BigInt(Number.MAX_SAFE_INTEGER) ||
        typeof value.receipt_layout_changed !== 'boolean'
      )
        throw new OwnerTelebirrFastAlertsUnavailableError();
      return {
        heldCount: Number(value.held_count),
        receiptLayoutChanged: value.receipt_layout_changed,
      };
    } catch {
      throw new OwnerTelebirrFastAlertsUnavailableError();
    }
  }
}
