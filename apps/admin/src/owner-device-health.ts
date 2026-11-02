export type OwnerDeviceHealthState = 'active' | 'signed_out' | 'checking' | 'attention' | 'unknown';

export interface OwnerDeviceHealthSnapshot {
  readonly companion: {
    readonly state: OwnerDeviceHealthState;
    readonly reportedAt: string | null;
  };
  readonly receiverPhone: {
    readonly state: OwnerDeviceHealthState;
    readonly reportedAt: string | null;
  };
  readonly checkedAt: string;
}

export class OwnerDeviceHealthRejectedError extends Error {}
export class OwnerDeviceHealthUnavailableError extends Error {}

const COMPANION_SQL =
  'select state, reported_at, checked_at from app.get_owner_companion_kemerbet_session_status($1::uuid)';
const PHONE_SQL =
  'select state, reported_at, checked_at from app.get_owner_receiver_sms_device_status($1::uuid)';

function timestamp(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    throw new OwnerDeviceHealthUnavailableError();
  return value.toISOString();
}

function decode(rows: readonly unknown[], allowed: readonly string[]) {
  const row = rows.length === 1 ? rows[0] : undefined;
  if (
    !row ||
    typeof row !== 'object' ||
    Array.isArray(row) ||
    Object.keys(row).sort().join(',') !== 'checked_at,reported_at,state'
  )
    throw new OwnerDeviceHealthUnavailableError();
  const value = row as Record<string, unknown>;
  const checkedAt = timestamp(value.checked_at);
  const reportedAt = value.reported_at === null ? null : timestamp(value.reported_at);
  if (
    (value.state !== null && !allowed.includes(value.state as string)) ||
    (value.state === null) !== (reportedAt === null) ||
    (reportedAt !== null && Date.parse(reportedAt) > Date.parse(checkedAt) + 30_000)
  )
    throw new OwnerDeviceHealthUnavailableError();
  return { state: value.state as string | null, reportedAt, checkedAt };
}

function recent(reportedAt: string | null, checkedAt: string): boolean {
  return reportedAt !== null && Date.parse(checkedAt) - Date.parse(reportedAt) < 90_000;
}

export class PostgresOwnerDeviceHealth {
  constructor(
    private readonly database: {
      query(sql: string, values: readonly string[]): Promise<{ readonly rows: readonly unknown[] }>;
    },
  ) {}

  async status(authUserId: string): Promise<OwnerDeviceHealthSnapshot> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(authUserId)
    )
      throw new OwnerDeviceHealthRejectedError();
    try {
      const companion = decode((await this.database.query(COMPANION_SQL, [authUserId])).rows, [
        'signed_in_verified',
        'sign_in_needed',
        'checking',
        'review_paused',
      ]);
      const phone = decode((await this.database.query(PHONE_SQL, [authUserId])).rows, [
        'ready',
        'attention',
      ]);
      return {
        companion: {
          state: !recent(companion.reportedAt, companion.checkedAt)
            ? 'unknown'
            : companion.state === 'signed_in_verified'
              ? 'active'
              : companion.state === 'sign_in_needed'
                ? 'signed_out'
                : companion.state === 'checking'
                  ? 'checking'
                  : 'attention',
          reportedAt: companion.reportedAt,
        },
        receiverPhone: {
          state: !recent(phone.reportedAt, phone.checkedAt)
            ? 'unknown'
            : phone.state === 'ready'
              ? 'active'
              : 'attention',
          reportedAt: phone.reportedAt,
        },
        checkedAt: companion.checkedAt,
      };
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '42501')
        throw new OwnerDeviceHealthRejectedError();
      throw new OwnerDeviceHealthUnavailableError();
    }
  }
}
