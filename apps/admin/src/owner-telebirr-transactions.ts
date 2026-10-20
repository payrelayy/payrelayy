export type OwnerTransactionGroup = 'all' | 'pending' | 'credited' | 'rejected';
export type OwnerTransactionDetail =
  'waiting_approval' | 'held_review' | 'checking' | 'credited' | 'rejected';

export interface OwnerTransactionFilters {
  readonly status: OwnerTransactionGroup;
  readonly from?: string;
  readonly to?: string;
  readonly last4?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface OwnerTransaction {
  readonly candidateId: string;
  readonly submittedAt: string;
  readonly paymentAt: string | null;
  readonly amountMinor: string | null;
  readonly referenceMasked: string;
  readonly playerMasked: string;
  readonly statusGroup: Exclude<OwnerTransactionGroup, 'all'>;
  readonly statusDetail: OwnerTransactionDetail;
  readonly reason: string | null;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly canDecide: boolean;
}

export interface OwnerTransactionsPage {
  readonly rows: readonly OwnerTransaction[];
  readonly total: number;
  readonly pending: number;
  readonly credited: number;
  readonly rejected: number;
  readonly waitingCount: number;
}

export interface OwnerTransactionsDatabase {
  query(
    sql: string,
    values: readonly (string | number | null)[],
  ): Promise<{ readonly rows: readonly unknown[] }>;
}

export class OwnerTransactionsRejectedError extends Error {}
export class OwnerTransactionsUnavailableError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const MASKED_REFERENCE = /^\*{3}[A-Z0-9]{4}$/u;
const MASKED_PLAYER = /^\*{3}[^\s\u0000-\u001f\u007f]{1,4}$/u;
const REASONS = new Set([
  'Payment older than 1 hour',
  'Invalid payment information',
  'Wrong receiver',
  'Payment already used',
  'Unrelated receipt',
  'Receipt layout needs review',
  'Payment check could not finish',
  'Payment was not eligible for credit',
  'Payment could not be verified',
  'Owner approved; credit in progress',
  'Credit in progress',
]);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new OwnerTransactionsUnavailableError();
  return value as Record<string, unknown>;
}

function timestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /\d{4}-\d{2}-\d{2}T/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function date(value: string | undefined): boolean {
  if (value === undefined) return true;
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new OwnerTransactionsUnavailableError();
  return value as number;
}

function transaction(value: unknown): OwnerTransaction {
  const row = record(value);
  if (
    !UUID.test(String(row.candidateId)) ||
    !timestamp(row.submittedAt) ||
    (row.paymentAt !== null && !timestamp(row.paymentAt)) ||
    (row.amountMinor !== null &&
      (typeof row.amountMinor !== 'string' || !/^[1-9][0-9]*$/u.test(row.amountMinor))) ||
    typeof row.referenceMasked !== 'string' ||
    !MASKED_REFERENCE.test(row.referenceMasked) ||
    typeof row.playerMasked !== 'string' ||
    !MASKED_PLAYER.test(row.playerMasked) ||
    !['pending', 'credited', 'rejected'].includes(String(row.statusGroup)) ||
    !['waiting_approval', 'held_review', 'checking', 'credited', 'rejected'].includes(
      String(row.statusDetail),
    ) ||
    (row.reason !== null && (typeof row.reason !== 'string' || !REASONS.has(row.reason))) ||
    (row.decidedBy !== null &&
      (typeof row.decidedBy !== 'string' ||
        row.decidedBy.length > 100 ||
        /[\u0000-\u001f\u007f]/u.test(row.decidedBy))) ||
    (row.decidedAt !== null && !timestamp(row.decidedAt)) ||
    typeof row.canDecide !== 'boolean' ||
    (row.canDecide && (row.statusDetail !== 'waiting_approval' || row.statusGroup !== 'pending')) ||
    (row.statusGroup === 'credited' && row.statusDetail !== 'credited') ||
    (row.statusGroup === 'rejected' && row.statusDetail !== 'rejected')
  )
    throw new OwnerTransactionsUnavailableError();
  return row as unknown as OwnerTransaction;
}

export class PostgresOwnerTelebirrTransactions {
  constructor(private readonly database: OwnerTransactionsDatabase) {}

  async list(authUserId: string, filters: OwnerTransactionFilters): Promise<OwnerTransactionsPage> {
    if (
      !UUID.test(authUserId) ||
      !['all', 'pending', 'credited', 'rejected'].includes(filters.status) ||
      !date(filters.from) ||
      !date(filters.to) ||
      (filters.from !== undefined && filters.to !== undefined && filters.from > filters.to) ||
      (filters.last4 !== undefined && !/^[A-Z0-9]{4}$/u.test(filters.last4)) ||
      !Number.isSafeInteger(filters.limit) ||
      filters.limit < 1 ||
      filters.limit > 50 ||
      !Number.isSafeInteger(filters.offset) ||
      filters.offset < 0
    )
      throw new OwnerTransactionsRejectedError();
    try {
      const result = await this.database.query(
        `select app.list_owner_routine_telebirr_transactions(
          $1::uuid,$2::text,$3::date,$4::date,$5::text,$6::integer,$7::integer
        ) as transactions`,
        [
          authUserId,
          filters.status,
          filters.from ?? null,
          filters.to ?? null,
          filters.last4 ?? null,
          filters.limit,
          filters.offset,
        ],
      );
      if (result.rows.length !== 1) throw new OwnerTransactionsUnavailableError();
      const page = record(record(result.rows[0]).transactions);
      if (!Array.isArray(page.rows) || page.rows.length > filters.limit)
        throw new OwnerTransactionsUnavailableError();
      return {
        rows: page.rows.map(transaction),
        total: count(page.total),
        pending: count(page.pending),
        credited: count(page.credited),
        rejected: count(page.rejected),
        waitingCount: count(page.waitingCount),
      };
    } catch (error) {
      if (error instanceof OwnerTransactionsUnavailableError) throw error;
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '42501')
        throw new OwnerTransactionsRejectedError();
      throw new OwnerTransactionsUnavailableError();
    }
  }
}
