import { isProxy } from 'node:util/types';

export type OwnerCompanionLookupState =
  'pending' | 'claimed' | 'signed' | 'completed' | 'review_required' | 'expired';

export interface OwnerCompanionLookupStatus {
  readonly assignmentId: string;
  readonly state: OwnerCompanionLookupState;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly completedAt?: string;
  readonly foundCount?: number;
  readonly notFoundCount?: number;
  readonly reviewRequiredCount?: number;
  readonly playerCount: 5;
  readonly platformCode: 'kemerbet';
  readonly lookupMode: 'find_only';
  readonly identifiersRedacted: true;
  readonly transferDisabled: true;
  readonly moneyMovementAllowed: false;
  readonly moneyMoved: false;
}

export interface OwnerCompanionLookupIssueReceipt extends OwnerCompanionLookupStatus {
  readonly alreadyIssued: boolean;
}

export interface OwnerCompanionLookupDatabase {
  query(sql: string, values: readonly string[]): Promise<{ readonly rows: readonly unknown[] }>;
}

export class OwnerCompanionLookupRejectedError extends Error {
  constructor() {
    super('The Owner exact-five companion lookup request was rejected.');
    this.name = 'OwnerCompanionLookupRejectedError';
  }
}

export class OwnerCompanionLookupNotReadyError extends Error {
  constructor() {
    super('The Owner exact-five companion lookup is not ready.');
    this.name = 'OwnerCompanionLookupNotReadyError';
  }
}

export class OwnerCompanionLookupUnavailableError extends Error {
  constructor() {
    super('The Owner exact-five companion lookup is unavailable.');
    this.name = 'OwnerCompanionLookupUnavailableError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SIGNER_KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const STATES = new Set<OwnerCompanionLookupState>([
  'pending',
  'claimed',
  'signed',
  'completed',
  'review_required',
  'expired',
]);

export const ISSUE_OWNER_COMPANION_LOOKUP_SQL = `
  select assignment_id,
         assignment_state,
         issued_at,
         expires_at,
         found_count,
         not_found_count,
         review_required_count,
         completed_at,
         replayed
    from app.issue_agent_platform_companion_exact_five_lookup(
      $1::uuid,
      $2::uuid,
      $3::text
    )
`;

export const GET_OWNER_COMPANION_LOOKUP_STATUS_SQL = `
  select assignment_id,
         assignment_state,
         issued_at,
         expires_at,
         found_count,
         not_found_count,
         review_required_count,
         completed_at
    from app.get_agent_platform_companion_exact_five_lookup_status($1::uuid)
`;

function databaseErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

function rowObject(row: unknown): Record<string, unknown> {
  if (
    typeof row !== 'object' ||
    row === null ||
    Array.isArray(row) ||
    isProxy(row) ||
    (Object.getPrototypeOf(row) !== Object.prototype && Object.getPrototypeOf(row) !== null)
  ) {
    throw new OwnerCompanionLookupUnavailableError();
  }
  return row as Record<string, unknown>;
}

function exactKeys(row: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(row).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function optionalCount(value: unknown): number | undefined {
  if (value === null) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 5) {
    throw new OwnerCompanionLookupUnavailableError();
  }
  return Number(value);
}

function optionalDate(value: unknown): string | undefined {
  if (value === null) return undefined;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new OwnerCompanionLookupUnavailableError();
  }
  return value.toISOString();
}

function statusFromRow(rowCandidate: unknown, includesReplay: boolean): OwnerCompanionLookupStatus {
  const row = rowObject(rowCandidate);
  if (
    !exactKeys(row, [
      'assignment_id',
      'assignment_state',
      'issued_at',
      'expires_at',
      'found_count',
      'not_found_count',
      'review_required_count',
      'completed_at',
      ...(includesReplay ? ['replayed'] : []),
    ]) ||
    typeof row.assignment_id !== 'string' ||
    !UUID_V4_PATTERN.test(row.assignment_id) ||
    typeof row.assignment_state !== 'string' ||
    !STATES.has(row.assignment_state as OwnerCompanionLookupState) ||
    !(row.issued_at instanceof Date) ||
    !(row.expires_at instanceof Date) ||
    !Number.isFinite(row.issued_at.getTime()) ||
    !Number.isFinite(row.expires_at.getTime()) ||
    row.expires_at.getTime() <= row.issued_at.getTime() ||
    row.expires_at.getTime() - row.issued_at.getTime() > 10 * 60 * 1_000
  ) {
    throw new OwnerCompanionLookupUnavailableError();
  }
  const foundCount = optionalCount(row.found_count);
  const notFoundCount = optionalCount(row.not_found_count);
  const reviewRequiredCount = optionalCount(row.review_required_count);
  const completedAt = optionalDate(row.completed_at);
  const terminal =
    row.assignment_state === 'completed' || row.assignment_state === 'review_required';
  if (
    terminal !== (completedAt !== undefined) ||
    terminal !==
      (foundCount !== undefined &&
        notFoundCount !== undefined &&
        reviewRequiredCount !== undefined) ||
    (terminal && foundCount! + notFoundCount! + reviewRequiredCount! !== 5)
  ) {
    throw new OwnerCompanionLookupUnavailableError();
  }
  return Object.freeze({
    assignmentId: row.assignment_id,
    state: row.assignment_state as OwnerCompanionLookupState,
    issuedAt: row.issued_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    ...(completedAt === undefined ? {} : { completedAt }),
    ...(foundCount === undefined ? {} : { foundCount }),
    ...(notFoundCount === undefined ? {} : { notFoundCount }),
    ...(reviewRequiredCount === undefined ? {} : { reviewRequiredCount }),
    playerCount: 5,
    platformCode: 'kemerbet',
    lookupMode: 'find_only',
    identifiersRedacted: true,
    transferDisabled: true,
    moneyMovementAllowed: false,
    moneyMoved: false,
  });
}

export class PostgresOwnerCompanionLookup {
  constructor(
    private readonly database: OwnerCompanionLookupDatabase,
    private readonly serverSignerKeyId: string,
  ) {
    if (!SIGNER_KEY_ID_PATTERN.test(serverSignerKeyId)) {
      throw new OwnerCompanionLookupRejectedError();
    }
  }

  async issue(authUserId: string, requestId: string): Promise<OwnerCompanionLookupIssueReceipt> {
    if (!UUID_PATTERN.test(authUserId) || !UUID_V4_PATTERN.test(requestId)) {
      throw new OwnerCompanionLookupRejectedError();
    }
    try {
      const result = await this.database.query(ISSUE_OWNER_COMPANION_LOOKUP_SQL, [
        authUserId,
        requestId,
        this.serverSignerKeyId,
      ]);
      if (result.rows.length !== 1) throw new OwnerCompanionLookupUnavailableError();
      const row = rowObject(result.rows[0]);
      if (typeof row.replayed !== 'boolean') throw new OwnerCompanionLookupUnavailableError();
      return Object.freeze({ ...statusFromRow(row, true), alreadyIssued: row.replayed });
    } catch (error) {
      if (
        error instanceof OwnerCompanionLookupRejectedError ||
        error instanceof OwnerCompanionLookupNotReadyError ||
        error instanceof OwnerCompanionLookupUnavailableError
      ) {
        throw error;
      }
      if (databaseErrorCode(error) === 'P0001' || databaseErrorCode(error) === '23505') {
        throw new OwnerCompanionLookupNotReadyError();
      }
      throw new OwnerCompanionLookupUnavailableError();
    }
  }

  async status(authUserId: string): Promise<OwnerCompanionLookupStatus | undefined> {
    if (!UUID_PATTERN.test(authUserId)) throw new OwnerCompanionLookupRejectedError();
    try {
      const result = await this.database.query(GET_OWNER_COMPANION_LOOKUP_STATUS_SQL, [authUserId]);
      if (result.rows.length === 0) return undefined;
      if (result.rows.length !== 1) throw new OwnerCompanionLookupUnavailableError();
      return statusFromRow(result.rows[0], false);
    } catch (error) {
      if (
        error instanceof OwnerCompanionLookupRejectedError ||
        error instanceof OwnerCompanionLookupUnavailableError
      ) {
        throw error;
      }
      if (databaseErrorCode(error) === 'P0001') throw new OwnerCompanionLookupRejectedError();
      throw new OwnerCompanionLookupUnavailableError();
    }
  }
}
