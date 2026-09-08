export interface OwnerCompanionConnectionStatus {
  readonly pairedDeviceCount: number;
  readonly validDeviceCount: number;
  readonly connectedDeviceCount: number;
  readonly lastSeenAt: string | null;
  readonly checkedAt: string;
}

export class OwnerCompanionConnectionRejectedError extends Error {}
export class OwnerCompanionConnectionUnavailableError extends Error {}

export const OWNER_COMPANION_CONNECTION_SQL = `
  select paired_device_count, valid_device_count, connected_device_count, last_seen_at, checked_at
    from app.get_owner_companion_connection_status($1::uuid)
`;

function timestamp(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new OwnerCompanionConnectionUnavailableError();
  }
  return value.toISOString();
}

export class PostgresOwnerCompanionConnection {
  constructor(
    private readonly database: {
      query(sql: string, values: readonly string[]): Promise<{ readonly rows: readonly unknown[] }>;
    },
  ) {}

  async status(authUserId: string): Promise<OwnerCompanionConnectionStatus> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(authUserId)
    ) {
      throw new OwnerCompanionConnectionRejectedError();
    }
    try {
      const { rows } = await this.database.query(OWNER_COMPANION_CONNECTION_SQL, [authUserId]);
      const row = rows[0] as Record<string, unknown> | undefined;
      if (
        rows.length !== 1 ||
        !row ||
        typeof row !== 'object' ||
        Array.isArray(row) ||
        Object.keys(row).sort().join(',') !==
          'checked_at,connected_device_count,last_seen_at,paired_device_count,valid_device_count'
      ) {
        throw new OwnerCompanionConnectionUnavailableError();
      }
      const counts = [row.paired_device_count, row.valid_device_count, row.connected_device_count];
      if (
        counts.some(
          (value) => typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0,
        )
      ) {
        throw new OwnerCompanionConnectionUnavailableError();
      }
      const pairedDeviceCount = row.paired_device_count as number;
      const validDeviceCount = row.valid_device_count as number;
      const connectedDeviceCount = row.connected_device_count as number;
      const checkedAt = timestamp(row.checked_at);
      const lastSeenAt = row.last_seen_at === null ? null : timestamp(row.last_seen_at);
      if (
        connectedDeviceCount > validDeviceCount ||
        validDeviceCount > pairedDeviceCount ||
        (pairedDeviceCount === 0 && lastSeenAt !== null) ||
        (lastSeenAt !== null && Date.parse(lastSeenAt) > Date.parse(checkedAt)) ||
        (connectedDeviceCount > 0 &&
          (lastSeenAt === null || Date.parse(checkedAt) - Date.parse(lastSeenAt) >= 60_000))
      ) {
        throw new OwnerCompanionConnectionUnavailableError();
      }
      return { pairedDeviceCount, validDeviceCount, connectedDeviceCount, lastSeenAt, checkedAt };
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '42501'
      ) {
        throw new OwnerCompanionConnectionRejectedError();
      }
      throw new OwnerCompanionConnectionUnavailableError();
    }
  }
}
