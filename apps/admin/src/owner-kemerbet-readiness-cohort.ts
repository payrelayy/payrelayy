import { timingSafeEqual } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { link, lstat, open, realpath, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';

import type { OwnerPlayerDepositEligibilityRecord } from './owner-player-deposit-eligibility.js';

const CONTROL_ROOT = '/run/fetanagent-kemerbet-session-control';
const STAGED_COHORT = `${CONTROL_ROOT}/kemerbet-readiness-player-ids.stage-v1`;
const INSTALLING_COHORT = `${CONTROL_ROOT}/.kemerbet-readiness-player-ids.stage-v1.installing`;
const STAGED_CLAIM = `${CONTROL_ROOT}/kemerbet-readiness-cohort-claim.stage-v1`;
const INSTALLING_CLAIM = `${CONTROL_ROOT}/.kemerbet-readiness-cohort-claim.stage-v1.installing`;
const IMPORTED_CLAIM = `${CONTROL_ROOT}/kemerbet-readiness-cohort-imported-v1`;
const INSTALLING_IMPORTED_CLAIM = `${CONTROL_ROOT}/.kemerbet-readiness-cohort-imported-v1.installing`;
const COMPLETED_CLAIM = `${CONTROL_ROOT}/kemerbet-readiness-cohort-completed-v1`;
const INSTALLING_COMPLETED_CLAIM = `${CONTROL_ROOT}/.kemerbet-readiness-cohort-completed-v1.installing`;
const FAILED_CLAIM = `${CONTROL_ROOT}/kemerbet-readiness-cohort-failed-v1`;
const INSTALLING_FAILED_CLAIM = `${CONTROL_ROOT}/.kemerbet-readiness-cohort-failed-v1.installing`;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RECORD_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PLAYER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const EXPECTED_EFFECTIVE_USER_ID = 10_001;
const EXPECTED_EFFECTIVE_GROUP_ID = 10_001;
const MAX_COHORT_BYTES = 1_024;

interface OwnerKemerbetReadinessFileBoundary {
  readonly completedClaim: string;
  readonly failedClaim: string;
  readonly controlRoot: string;
  readonly importedClaim: string;
  readonly installingClaim: string;
  readonly installingCohort: string;
  readonly installingCompletedClaim: string;
  readonly installingFailedClaim: string;
  readonly installingImportedClaim: string;
  readonly processGroupId: number;
  readonly processUserId: number;
  readonly stagedClaim: string;
  readonly stagedCohort: string;
  readonly completedClaimGroupId: number;
  readonly completedClaimUserId: number;
  readonly frozenStageGroupId: number;
  readonly frozenStageUserId: number;
}

function fileBoundary(
  controlRoot: string,
  processUserId: number,
  processGroupId: number,
  completedClaimUserId: number,
  completedClaimGroupId: number,
  frozenStageUserId: number,
  frozenStageGroupId: number,
): OwnerKemerbetReadinessFileBoundary {
  return {
    completedClaim: `${controlRoot}/kemerbet-readiness-cohort-completed-v1`,
    completedClaimGroupId,
    completedClaimUserId,
    controlRoot,
    failedClaim: `${controlRoot}/kemerbet-readiness-cohort-failed-v1`,
    frozenStageGroupId,
    frozenStageUserId,
    importedClaim: `${controlRoot}/kemerbet-readiness-cohort-imported-v1`,
    installingClaim: `${controlRoot}/.kemerbet-readiness-cohort-claim.stage-v1.installing`,
    installingCohort: `${controlRoot}/.kemerbet-readiness-player-ids.stage-v1.installing`,
    installingCompletedClaim: `${controlRoot}/.kemerbet-readiness-cohort-completed-v1.installing`,
    installingFailedClaim: `${controlRoot}/.kemerbet-readiness-cohort-failed-v1.installing`,
    installingImportedClaim: `${controlRoot}/.kemerbet-readiness-cohort-imported-v1.installing`,
    processGroupId,
    processUserId,
    stagedClaim: `${controlRoot}/kemerbet-readiness-cohort-claim.stage-v1`,
    stagedCohort: `${controlRoot}/kemerbet-readiness-player-ids.stage-v1`,
  };
}

const PRODUCTION_FILE_BOUNDARY: OwnerKemerbetReadinessFileBoundary = {
  completedClaim: COMPLETED_CLAIM,
  completedClaimGroupId: EXPECTED_EFFECTIVE_GROUP_ID,
  completedClaimUserId: 0,
  controlRoot: CONTROL_ROOT,
  failedClaim: FAILED_CLAIM,
  frozenStageGroupId: 0,
  frozenStageUserId: 0,
  importedClaim: IMPORTED_CLAIM,
  installingClaim: INSTALLING_CLAIM,
  installingCohort: INSTALLING_COHORT,
  installingCompletedClaim: INSTALLING_COMPLETED_CLAIM,
  installingFailedClaim: INSTALLING_FAILED_CLAIM,
  installingImportedClaim: INSTALLING_IMPORTED_CLAIM,
  processGroupId: EXPECTED_EFFECTIVE_GROUP_ID,
  processUserId: EXPECTED_EFFECTIVE_USER_ID,
  stagedClaim: STAGED_CLAIM,
  stagedCohort: STAGED_COHORT,
};
const LINUX_TEST_BOUNDARY_TOKEN: unique symbol = Symbol('linux-test-boundary');

export interface OwnerKemerbetReadinessCohortReceipt {
  readonly alreadyPrepared: boolean;
  readonly identifiersRedacted: true;
  readonly moneyMoved: false;
  readonly playersPrepared: 5;
  readonly transferDisabled: true;
}

export type OwnerKemerbetReadinessRootReceiptEvent = 'completed' | 'imported' | 'retryable_failed';

/** Server-only reconciliation result. Never project the claim identity into an HTTP response. */
export interface OwnerKemerbetReadinessRootReceipt {
  readonly claimId: string;
  readonly event: OwnerKemerbetReadinessRootReceiptEvent;
}

export type OwnerKemerbetReadinessCohortClaimState =
  'exported' | 'failed_terminal' | 'imported' | 'prepared' | 'succeeded';

export interface OwnerKemerbetReadinessCohortClaim {
  readonly alreadyClaimed: boolean;
  readonly claimId: string;
  readonly players: readonly OwnerPlayerDepositEligibilityRecord[];
  readonly state: OwnerKemerbetReadinessCohortClaimState;
}

export interface OwnerKemerbetReadinessCohortClaimTransition {
  readonly alreadyRecorded: boolean;
  readonly claimId: string;
  readonly state: 'exported';
  readonly transitionedAt: string;
}

export type OwnerKemerbetReadinessCohortDatabaseReceiptEvent =
  'completed' | 'failed_terminal' | 'imported';

export type OwnerKemerbetReadinessCohortFailureCode =
  | 'import_failed_cleanup_confirmed'
  | 'operator_cancelled_cleanup_confirmed'
  | 'recheck_failed_cleanup_confirmed'
  | 'recovery_failed_cleanup_confirmed';

export interface OwnerKemerbetReadinessCohortDatabaseReceipt {
  readonly alreadyRecorded: boolean;
  readonly claimId: string;
  readonly event: OwnerKemerbetReadinessCohortDatabaseReceiptEvent;
  readonly receiptId: string;
  readonly state: 'failed_terminal' | 'imported' | 'succeeded';
  readonly recordedAt: string;
}

export interface OwnerKemerbetReadinessCohortClaimDatabase {
  query(
    sql: string,
    values: readonly (string | null)[],
  ): Promise<{ readonly rows: readonly unknown[] }>;
}

export interface OwnerKemerbetReadinessCohortControl {
  completed(claimId: string): Promise<boolean>;
  prepare(
    players: readonly OwnerPlayerDepositEligibilityRecord[],
    requestId: string,
    claimId: string,
  ): Promise<OwnerKemerbetReadinessCohortReceipt>;
  rootReceipt(): Promise<OwnerKemerbetReadinessRootReceipt | undefined>;
}

export class OwnerKemerbetReadinessCohortRejectedError extends Error {
  constructor() {
    super('The Owner KemerBet readiness cohort request was rejected.');
    this.name = 'OwnerKemerbetReadinessCohortRejectedError';
  }
}

export class OwnerKemerbetReadinessCohortUnavailableError extends Error {
  constructor() {
    super('The Owner KemerBet readiness cohort staging boundary is unavailable.');
    this.name = 'OwnerKemerbetReadinessCohortUnavailableError';
  }
}

const PREPARE_CLAIM_SQL = `
  select cohort_id,
         cohort_state,
         cohort_already_claimed,
         member_ordinal,
         player_account_id,
         platform_code,
         player_id,
         player_status,
         validation_status,
         decision_id,
         decision_version,
         decision,
         reason_code,
         decided_at
    from app.prepare_owner_kemerbet_readiness_cohort_claim($1::uuid, $2::uuid)
   order by member_ordinal
`;

const ADVANCE_CLAIM_SQL = `
  select advanced_claim_id,
         advanced_claim_state,
         transition_already_recorded,
         transitioned_at
    from app.advance_owner_kemerbet_readiness_cohort_claim(
      $1::uuid,
      $2::uuid,
      $3::uuid,
      $4::text
    )
`;

const RECORD_ROOT_RECEIPT_SQL = `
  select recorded_receipt_id,
         recorded_claim_id,
         recorded_claim_state,
         recorded_receipt_event,
         receipt_already_recorded,
         recorded_at
    from app.record_owner_kemerbet_readiness_cohort_root_receipt(
      $1::uuid,
      $2::uuid,
      $3::text,
      $4::text
    )
`;

function databaseErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

function databaseRow(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OwnerKemerbetReadinessCohortUnavailableError();
  }
  return value as Record<string, unknown>;
}

function exactDatabaseTimestamp(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new OwnerKemerbetReadinessCohortUnavailableError();
  }
  return value.toISOString();
}

export class PostgresOwnerKemerbetReadinessCohortClaims {
  constructor(private readonly database: OwnerKemerbetReadinessCohortClaimDatabase) {}

  async claim(authUserId: string, requestId: string): Promise<OwnerKemerbetReadinessCohortClaim> {
    if (!RECORD_ID_PATTERN.test(authUserId) || !REQUEST_ID_PATTERN.test(requestId)) {
      throw new OwnerKemerbetReadinessCohortRejectedError();
    }
    try {
      const result = await this.database.query(PREPARE_CLAIM_SQL, [authUserId, requestId]);
      if (result.rows.length !== 5) {
        throw new OwnerKemerbetReadinessCohortUnavailableError();
      }
      const rows = result.rows.map(databaseRow);
      const first = rows[0]!;
      if (
        typeof first.cohort_id !== 'string' ||
        !RECORD_ID_PATTERN.test(first.cohort_id) ||
        (first.cohort_state !== 'prepared' &&
          first.cohort_state !== 'exported' &&
          first.cohort_state !== 'imported' &&
          first.cohort_state !== 'succeeded' &&
          first.cohort_state !== 'failed_terminal') ||
        typeof first.cohort_already_claimed !== 'boolean'
      ) {
        throw new OwnerKemerbetReadinessCohortUnavailableError();
      }
      const players = rows.map((row, index): OwnerPlayerDepositEligibilityRecord => {
        if (
          row.cohort_id !== first.cohort_id ||
          row.cohort_state !== first.cohort_state ||
          row.cohort_already_claimed !== first.cohort_already_claimed ||
          row.member_ordinal !== index + 1 ||
          typeof row.player_account_id !== 'string' ||
          !RECORD_ID_PATTERN.test(row.player_account_id) ||
          row.platform_code !== 'kemerbet' ||
          typeof row.player_id !== 'string' ||
          !PLAYER_ID_PATTERN.test(row.player_id) ||
          row.player_status !== 'active' ||
          row.validation_status !== 'valid' ||
          typeof row.decision_id !== 'string' ||
          !RECORD_ID_PATTERN.test(row.decision_id) ||
          !Number.isSafeInteger(row.decision_version) ||
          Number(row.decision_version) < 1 ||
          row.decision !== 'eligible' ||
          row.reason_code !== 'financial_eligibility_approved'
        ) {
          throw new OwnerKemerbetReadinessCohortUnavailableError();
        }
        return {
          decidedAt: exactDatabaseTimestamp(row.decided_at),
          decision: 'eligible',
          decisionId: row.decision_id,
          decisionVersion: row.decision_version as number,
          playerAccountId: row.player_account_id,
          playerId: row.player_id,
          playerStatus: 'active',
          platformCode: 'kemerbet',
          reasonCode: 'financial_eligibility_approved',
          validationStatus: 'valid',
        };
      });
      if (
        new Set(players.map((player) => player.playerAccountId)).size !== 5 ||
        new Set(players.map((player) => player.playerId)).size !== 5 ||
        new Set(players.map((player) => player.decisionId)).size !== 5
      ) {
        throw new OwnerKemerbetReadinessCohortUnavailableError();
      }
      return {
        alreadyClaimed: first.cohort_already_claimed,
        claimId: first.cohort_id,
        players,
        state: first.cohort_state,
      };
    } catch (error) {
      if (error instanceof OwnerKemerbetReadinessCohortUnavailableError) throw error;
      if (databaseErrorCode(error) === 'P0001' || databaseErrorCode(error) === '23505') {
        throw new OwnerKemerbetReadinessCohortRejectedError();
      }
      throw new OwnerKemerbetReadinessCohortUnavailableError();
    }
  }

  async markExported(
    authUserId: string,
    requestId: string,
    claimId: string,
  ): Promise<OwnerKemerbetReadinessCohortClaimTransition> {
    return this.advance(authUserId, requestId, claimId, 'exported');
  }

  private async advance(
    authUserId: string,
    requestId: string,
    claimId: string,
    transition: 'exported',
  ): Promise<OwnerKemerbetReadinessCohortClaimTransition> {
    if (
      !RECORD_ID_PATTERN.test(authUserId) ||
      !REQUEST_ID_PATTERN.test(requestId) ||
      !RECORD_ID_PATTERN.test(claimId)
    ) {
      throw new OwnerKemerbetReadinessCohortRejectedError();
    }
    try {
      const result = await this.database.query(ADVANCE_CLAIM_SQL, [
        authUserId,
        requestId,
        claimId,
        transition,
      ]);
      const row = result.rows.length === 1 ? databaseRow(result.rows[0]) : undefined;
      if (
        !row ||
        row.advanced_claim_id !== claimId ||
        row.advanced_claim_state !== transition ||
        typeof row.transition_already_recorded !== 'boolean'
      ) {
        throw new OwnerKemerbetReadinessCohortUnavailableError();
      }
      return {
        alreadyRecorded: row.transition_already_recorded,
        claimId,
        state: transition,
        transitionedAt: exactDatabaseTimestamp(row.transitioned_at),
      };
    } catch (error) {
      if (error instanceof OwnerKemerbetReadinessCohortUnavailableError) throw error;
      if (databaseErrorCode(error) === 'P0001' || databaseErrorCode(error) === '23505') {
        throw new OwnerKemerbetReadinessCohortRejectedError();
      }
      throw new OwnerKemerbetReadinessCohortUnavailableError();
    }
  }

  async recordRootReceipt(
    claimId: string,
    receiptId: string,
    event: OwnerKemerbetReadinessCohortDatabaseReceiptEvent,
    failureCode?: OwnerKemerbetReadinessCohortFailureCode,
  ): Promise<OwnerKemerbetReadinessCohortDatabaseReceipt> {
    const validFailureCode =
      failureCode === 'import_failed_cleanup_confirmed' ||
      failureCode === 'operator_cancelled_cleanup_confirmed' ||
      failureCode === 'recheck_failed_cleanup_confirmed' ||
      failureCode === 'recovery_failed_cleanup_confirmed';
    if (
      !RECORD_ID_PATTERN.test(claimId) ||
      !REQUEST_ID_PATTERN.test(receiptId) ||
      (event !== 'imported' && event !== 'completed' && event !== 'failed_terminal') ||
      (event === 'failed_terminal' ? !validFailureCode : failureCode !== undefined)
    ) {
      throw new OwnerKemerbetReadinessCohortRejectedError();
    }
    try {
      const result = await this.database.query(RECORD_ROOT_RECEIPT_SQL, [
        claimId,
        receiptId,
        event,
        failureCode ?? null,
      ]);
      const row = result.rows.length === 1 ? databaseRow(result.rows[0]) : undefined;
      const recordedState = row?.recorded_claim_state;
      const alreadyRecorded = row?.receipt_already_recorded;
      const stateMatchesEvent =
        event === 'imported'
          ? recordedState === 'imported' || recordedState === 'succeeded'
          : event === 'completed'
            ? recordedState === 'succeeded'
            : recordedState === 'failed_terminal';
      if (
        !row ||
        typeof row.recorded_receipt_id !== 'string' ||
        !RECORD_ID_PATTERN.test(row.recorded_receipt_id) ||
        row.recorded_claim_id !== claimId ||
        !stateMatchesEvent ||
        row.recorded_receipt_event !== event ||
        typeof alreadyRecorded !== 'boolean' ||
        (!alreadyRecorded && row.recorded_receipt_id !== receiptId) ||
        (event === 'imported' && recordedState === 'succeeded' && !alreadyRecorded)
      ) {
        throw new OwnerKemerbetReadinessCohortUnavailableError();
      }
      return {
        alreadyRecorded,
        claimId,
        event,
        receiptId: row.recorded_receipt_id,
        state: recordedState as 'failed_terminal' | 'imported' | 'succeeded',
        recordedAt: exactDatabaseTimestamp(row.recorded_at),
      };
    } catch (error) {
      if (error instanceof OwnerKemerbetReadinessCohortUnavailableError) throw error;
      if (databaseErrorCode(error) === 'P0001' || databaseErrorCode(error) === '23505') {
        throw new OwnerKemerbetReadinessCohortRejectedError();
      }
      throw new OwnerKemerbetReadinessCohortUnavailableError();
    }
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === code
  );
}

function isExactIsoTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

/**
 * Derive the server-only, newline-delimited executor input from the current
 * Owner eligibility history. Callers must never return or log this Buffer.
 */
export function deriveOwnerKemerbetReadinessCohortFile(
  players: readonly OwnerPlayerDepositEligibilityRecord[],
): Buffer {
  const eligible = players
    .filter(
      (player) =>
        player.platformCode === 'kemerbet' &&
        player.playerStatus === 'active' &&
        player.validationStatus === 'valid' &&
        player.decision === 'eligible' &&
        player.reasonCode === 'financial_eligibility_approved' &&
        typeof player.decisionId === 'string' &&
        RECORD_ID_PATTERN.test(player.decisionId) &&
        Number.isSafeInteger(player.decisionVersion) &&
        (player.decisionVersion ?? 0) > 0 &&
        typeof player.decidedAt === 'string' &&
        isExactIsoTimestamp(player.decidedAt),
    )
    .sort((left, right) =>
      left.playerAccountId < right.playerAccountId
        ? -1
        : left.playerAccountId > right.playerAccountId
          ? 1
          : 0,
    );
  if (
    eligible.length !== 5 ||
    eligible.some((player) => !RECORD_ID_PATTERN.test(player.playerAccountId)) ||
    new Set(eligible.map((player) => player.playerAccountId)).size !== 5 ||
    new Set(eligible.map((player) => player.playerId)).size !== 5 ||
    eligible.some((player) => !PLAYER_ID_PATTERN.test(player.playerId))
  ) {
    throw new OwnerKemerbetReadinessCohortRejectedError();
  }
  const content = Buffer.from(`${eligible.map((player) => player.playerId).join('\n')}\n`, 'utf8');
  if (content.byteLength < 10 || content.byteLength > MAX_COHORT_BYTES) {
    throw new OwnerKemerbetReadinessCohortRejectedError();
  }
  return content;
}

function exactContent(left: Buffer, right: Buffer): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

function sameControlRoot(left: Stats, right: Stats): boolean {
  return (
    right.dev === left.dev &&
    right.ino === left.ino &&
    right.uid === left.uid &&
    right.gid === left.gid &&
    right.mode === left.mode &&
    right.nlink === left.nlink
  );
}

function sameFileIdentity(left: Stats, right: Stats): boolean {
  return (
    right.dev === left.dev &&
    right.ino === left.ino &&
    right.uid === left.uid &&
    right.gid === left.gid &&
    right.mode === left.mode &&
    right.size === left.size
  );
}

async function assertControlRoot(boundary: OwnerKemerbetReadinessFileBoundary): Promise<Stats> {
  const before = await lstat(boundary.controlRoot);
  if (
    !before.isDirectory() ||
    before.isSymbolicLink() ||
    before.uid !== boundary.processUserId ||
    before.gid !== boundary.processGroupId ||
    (before.mode & 0o7777) !== 0o700 ||
    (await realpath(boundary.controlRoot)) !== boundary.controlRoot
  ) {
    throw new OwnerKemerbetReadinessCohortUnavailableError();
  }
  const after = await lstat(boundary.controlRoot);
  if (!sameControlRoot(before, after)) {
    throw new OwnerKemerbetReadinessCohortUnavailableError();
  }
  return after;
}

async function assertPathAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return;
    throw new OwnerKemerbetReadinessCohortUnavailableError();
  }
  throw new OwnerKemerbetReadinessCohortUnavailableError();
}

async function syncControlRoot(
  boundary: OwnerKemerbetReadinessFileBoundary,
  expected: Stats,
): Promise<void> {
  const handle = await open(
    boundary.controlRoot,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const before = await handle.stat();
    if (!before.isDirectory() || !sameControlRoot(expected, before)) {
      throw new OwnerKemerbetReadinessCohortUnavailableError();
    }
    await handle.sync();
    const after = await handle.stat();
    if (!after.isDirectory() || !sameControlRoot(before, after)) {
      throw new OwnerKemerbetReadinessCohortUnavailableError();
    }
  } finally {
    await handle.close();
  }
  if (!sameControlRoot(expected, await assertControlRoot(boundary))) {
    throw new OwnerKemerbetReadinessCohortUnavailableError();
  }
}

interface ExactControlFileRead {
  readonly content: Buffer;
  readonly identity: Stats;
}

async function readExactControlFile(
  path: string,
  expectedUserId: number,
  expectedGroupId: number,
  expectedMode: number,
  expectedLinks: number,
  minimumBytes: number,
  maximumBytes: number,
): Promise<ExactControlFileRead | undefined> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return undefined;
    throw error;
  }
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.uid !== expectedUserId ||
      before.gid !== expectedGroupId ||
      (before.mode & 0o7777) !== expectedMode ||
      before.nlink !== expectedLinks ||
      before.size < minimumBytes ||
      before.size > maximumBytes
    ) {
      throw new OwnerKemerbetReadinessCohortUnavailableError();
    }
    const content = await handle.readFile();
    if (content.byteLength !== before.size) {
      throw new OwnerKemerbetReadinessCohortUnavailableError();
    }
    const after = await handle.stat();
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.uid !== before.uid ||
      after.gid !== before.gid ||
      after.mode !== before.mode ||
      after.nlink !== before.nlink ||
      after.size !== before.size
    ) {
      throw new OwnerKemerbetReadinessCohortUnavailableError();
    }
    const pathStat = await lstat(path);
    if (
      pathStat.isSymbolicLink() ||
      pathStat.dev !== before.dev ||
      pathStat.ino !== before.ino ||
      pathStat.uid !== before.uid ||
      pathStat.gid !== before.gid ||
      pathStat.mode !== before.mode ||
      pathStat.nlink !== before.nlink ||
      pathStat.size !== before.size
    ) {
      throw new OwnerKemerbetReadinessCohortUnavailableError();
    }
    return { content, identity: after };
  } finally {
    await handle.close();
  }
}

async function exactControlFile(
  path: string,
  content: Buffer,
  expectedUserId: number,
  expectedGroupId: number,
  expectedMode: number,
  expectedLinks = 1,
): Promise<boolean | undefined> {
  const file = await readExactControlFile(
    path,
    expectedUserId,
    expectedGroupId,
    expectedMode,
    expectedLinks,
    content.byteLength,
    content.byteLength,
  );
  return file ? exactContent(file.content, content) : undefined;
}

async function assertExactServiceFile(
  boundary: OwnerKemerbetReadinessFileBoundary,
  path: string,
  content: Buffer,
): Promise<void> {
  if (
    (await exactControlFile(
      path,
      content,
      boundary.processUserId,
      boundary.processGroupId,
      0o400,
    )) !== true
  ) {
    throw new OwnerKemerbetReadinessCohortUnavailableError();
  }
}

function exactUuidContent(claimId: string): Buffer {
  return Buffer.from(`${claimId}\n`, 'ascii');
}

function validateCohortContent(content: Buffer): void {
  const decoded = content.toString('utf8');
  if (!exactContent(Buffer.from(decoded, 'utf8'), content) || !decoded.endsWith('\n')) {
    throw new OwnerKemerbetReadinessCohortRejectedError();
  }
  const lines = decoded.split('\n');
  const players = lines.length === 6 && lines[5] === '' ? lines.slice(0, 5) : [];
  if (
    players.length !== 5 ||
    players.some((player) => !PLAYER_ID_PATTERN.test(player)) ||
    new Set(players).size !== 5
  ) {
    throw new OwnerKemerbetReadinessCohortRejectedError();
  }
}

interface RootClaimMarker {
  readonly claimId: string;
  readonly event: OwnerKemerbetReadinessRootReceiptEvent;
  readonly identity: Stats;
}

async function readRootClaimMarker(
  boundary: OwnerKemerbetReadinessFileBoundary,
  path: string,
  event: OwnerKemerbetReadinessRootReceiptEvent,
): Promise<RootClaimMarker | undefined> {
  const marker = await readExactControlFile(
    path,
    boundary.completedClaimUserId,
    boundary.completedClaimGroupId,
    0o440,
    1,
    37,
    37,
  );
  if (!marker) return undefined;
  const claimId = marker.content.subarray(0, 36).toString('ascii');
  if (
    !RECORD_ID_PATTERN.test(claimId) ||
    !exactContent(marker.content, exactUuidContent(claimId))
  ) {
    throw new OwnerKemerbetReadinessCohortRejectedError();
  }
  return { claimId, event, identity: marker.identity };
}

async function readRootClaimMarkerSet(
  boundary: OwnerKemerbetReadinessFileBoundary,
): Promise<RootClaimMarker | undefined> {
  await Promise.all([
    assertPathAbsent(boundary.installingImportedClaim),
    assertPathAbsent(boundary.installingCompletedClaim),
    assertPathAbsent(boundary.installingFailedClaim),
  ]);
  const markers = (
    await Promise.all([
      readRootClaimMarker(boundary, boundary.importedClaim, 'imported'),
      readRootClaimMarker(boundary, boundary.completedClaim, 'completed'),
      readRootClaimMarker(boundary, boundary.failedClaim, 'retryable_failed'),
    ])
  ).filter((marker): marker is RootClaimMarker => marker !== undefined);
  if (markers.length > 1) {
    throw new OwnerKemerbetReadinessCohortUnavailableError();
  }
  return markers[0];
}

function sameRootClaimMarker(
  left: RootClaimMarker | undefined,
  right: RootClaimMarker | undefined,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.claimId === right.claimId &&
    left.event === right.event &&
    sameFileIdentity(left.identity, right.identity) &&
    left.identity.nlink === right.identity.nlink
  );
}

async function readServiceCohort(
  boundary: OwnerKemerbetReadinessFileBoundary,
  expectedUserId: number,
  expectedGroupId: number,
  expectedMode: number,
): Promise<ExactControlFileRead | undefined> {
  const cohort = await readExactControlFile(
    boundary.stagedCohort,
    expectedUserId,
    expectedGroupId,
    expectedMode,
    1,
    10,
    MAX_COHORT_BYTES,
  );
  if (cohort) validateCohortContent(cohort.content);
  return cohort;
}

async function assertExactStagePair(
  boundary: OwnerKemerbetReadinessFileBoundary,
  claimId: string,
  expectedUserId: number,
  expectedGroupId: number,
  expectedMode: number,
): Promise<void> {
  const [claimMatches, cohort] = await Promise.all([
    exactControlFile(
      boundary.stagedClaim,
      exactUuidContent(claimId),
      expectedUserId,
      expectedGroupId,
      expectedMode,
    ),
    readServiceCohort(boundary, expectedUserId, expectedGroupId, expectedMode),
  ]);
  if (claimMatches !== true || !cohort) {
    if (claimMatches === false) throw new OwnerKemerbetReadinessCohortRejectedError();
    throw new OwnerKemerbetReadinessCohortUnavailableError();
  }
}

async function assertImportedStageState(
  boundary: OwnerKemerbetReadinessFileBoundary,
  claimId: string,
): Promise<void> {
  const [claim, cohort] = await Promise.all([
    readExactControlFile(
      boundary.stagedClaim,
      boundary.frozenStageUserId,
      boundary.frozenStageGroupId,
      0o444,
      1,
      37,
      37,
    ),
    readServiceCohort(boundary, boundary.frozenStageUserId, boundary.frozenStageGroupId, 0o444),
  ]);
  if (claim && !exactContent(claim.content, exactUuidContent(claimId))) {
    throw new OwnerKemerbetReadinessCohortRejectedError();
  }
  // During the helper's durable success commit, either frozen source can be
  // consumed first. Each source is therefore independently exact or absent.
  void cohort;
}

async function assertReceiptStageState(
  boundary: OwnerKemerbetReadinessFileBoundary,
  marker: RootClaimMarker,
): Promise<void> {
  await Promise.all([
    assertPathAbsent(boundary.installingClaim),
    assertPathAbsent(boundary.installingCohort),
  ]);
  if (marker.event === 'completed') {
    await Promise.all([
      assertPathAbsent(boundary.stagedClaim),
      assertPathAbsent(boundary.stagedCohort),
      assertPathAbsent(boundary.importedClaim),
      assertPathAbsent(boundary.failedClaim),
    ]);
    return;
  }
  if (marker.event === 'retryable_failed') {
    await assertPathAbsent(boundary.importedClaim);
    await assertPathAbsent(boundary.completedClaim);
    await assertExactStagePair(
      boundary,
      marker.claimId,
      boundary.processUserId,
      boundary.processGroupId,
      0o400,
    );
    return;
  }
  await Promise.all([
    assertPathAbsent(boundary.completedClaim),
    assertPathAbsent(boundary.failedClaim),
  ]);
  await assertImportedStageState(boundary, marker.claimId);
}

async function pathPresent(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return false;
    throw new OwnerKemerbetReadinessCohortUnavailableError();
  }
}

async function assertInitialPairTopology(
  boundary: OwnerKemerbetReadinessFileBoundary,
): Promise<void> {
  const [claimStaged, claimInstalling, cohortStaged, cohortInstalling] = await Promise.all([
    pathPresent(boundary.stagedClaim),
    pathPresent(boundary.installingClaim),
    pathPresent(boundary.stagedCohort),
    pathPresent(boundary.installingCohort),
  ]);
  if ((cohortStaged || cohortInstalling) && !claimStaged && !claimInstalling) {
    throw new OwnerKemerbetReadinessCohortUnavailableError();
  }
}

async function unlinkOwnedInstallingFile(
  installingPath: string,
  handle: Awaited<ReturnType<typeof open>>,
  expected: Stats,
  remainingLinks: 0 | 1,
): Promise<void> {
  const before = await handle.stat();
  const pathStat = await lstat(installingPath);
  if (
    !before.isFile() ||
    pathStat.isSymbolicLink() ||
    !sameFileIdentity(expected, before) ||
    !sameFileIdentity(before, pathStat) ||
    before.nlink !== remainingLinks + 1 ||
    pathStat.nlink !== before.nlink
  ) {
    throw new OwnerKemerbetReadinessCohortUnavailableError();
  }
  await unlink(installingPath);
  const after = await handle.stat();
  if (!sameFileIdentity(before, after) || after.nlink !== remainingLinks) {
    throw new OwnerKemerbetReadinessCohortUnavailableError();
  }
}

interface StagedControlFilePaths {
  readonly installing: string;
  readonly staged: string;
}

async function recoverInstallingFile(
  boundary: OwnerKemerbetReadinessFileBoundary,
  paths: StagedControlFilePaths,
  content: Buffer,
  rootBefore: Stats,
): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(paths.installing, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return false;
    throw new OwnerKemerbetReadinessCohortUnavailableError();
  }
  try {
    const opened = await handle.stat();
    const installingStat = await lstat(paths.installing);
    if (
      !opened.isFile() ||
      installingStat.isSymbolicLink() ||
      !sameFileIdentity(opened, installingStat) ||
      opened.uid !== boundary.processUserId ||
      opened.gid !== boundary.processGroupId ||
      (opened.mode & 0o7777) !== 0o400 ||
      (opened.nlink !== 1 && opened.nlink !== 2) ||
      opened.size > content.byteLength
    ) {
      throw new OwnerKemerbetReadinessCohortUnavailableError();
    }

    let stagedStat: Stats | undefined;
    try {
      stagedStat = await lstat(paths.staged);
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) {
        throw new OwnerKemerbetReadinessCohortUnavailableError();
      }
    }

    if (opened.size < content.byteLength) {
      if (opened.nlink !== 1 || stagedStat !== undefined) {
        throw new OwnerKemerbetReadinessCohortUnavailableError();
      }
      await unlinkOwnedInstallingFile(paths.installing, handle, opened, 0);
      await syncControlRoot(boundary, rootBefore);
      await assertPathAbsent(paths.installing);
      return false;
    }
    if (!exactContent(await handle.readFile(), content)) {
      throw new OwnerKemerbetReadinessCohortRejectedError();
    }
    // A complete installer can be observed after its writer finished the write but before that
    // writer's fsync completed. Flush the exact inode ourselves before making it reachable through
    // the staged name, so takeover cannot advance the DB ahead of durable file contents.
    await handle.sync();

    if (opened.nlink === 1) {
      if (stagedStat !== undefined) throw new OwnerKemerbetReadinessCohortUnavailableError();
      await link(paths.installing, paths.staged);
      stagedStat = await lstat(paths.staged);
    }
    if (
      !stagedStat ||
      stagedStat.isSymbolicLink() ||
      stagedStat.dev !== opened.dev ||
      stagedStat.ino !== opened.ino ||
      stagedStat.uid !== opened.uid ||
      stagedStat.gid !== opened.gid ||
      stagedStat.mode !== opened.mode ||
      stagedStat.size !== opened.size ||
      stagedStat.nlink !== 2
    ) {
      throw new OwnerKemerbetReadinessCohortUnavailableError();
    }
    const linked = await handle.stat();
    if (!sameFileIdentity(opened, linked) || linked.nlink !== 2) {
      throw new OwnerKemerbetReadinessCohortUnavailableError();
    }
    await unlinkOwnedInstallingFile(paths.installing, handle, linked, 1);
    await syncControlRoot(boundary, rootBefore);
    await assertExactServiceFile(boundary, paths.staged, content);
    await assertPathAbsent(paths.installing);
    return true;
  } finally {
    await handle.close();
  }
}

async function installStagedControlFile(
  boundary: OwnerKemerbetReadinessFileBoundary,
  paths: StagedControlFilePaths,
  content: Buffer,
  rootBefore: Stats,
): Promise<boolean> {
  if (await recoverInstallingFile(boundary, paths, content, rootBefore)) return false;
  const existingMatches = await exactControlFile(
    paths.staged,
    content,
    boundary.processUserId,
    boundary.processGroupId,
    0o400,
  );
  if (existingMatches !== undefined) {
    if (!existingMatches) throw new OwnerKemerbetReadinessCohortRejectedError();
    await assertPathAbsent(paths.installing);
    await assertExactServiceFile(boundary, paths.staged, content);
    return true;
  }

  let installingHandle: Awaited<ReturnType<typeof open>> | undefined;
  let installingIdentity: Stats | undefined;
  let installingOwned = false;
  let stagedLinkCreated = false;
  try {
    installingHandle = await open(
      paths.installing,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o400,
    );
    installingOwned = true;
    await installingHandle.writeFile(content);
    await installingHandle.sync();
    installingIdentity = await installingHandle.stat();
    await assertExactServiceFile(boundary, paths.installing, content);
    try {
      await link(paths.installing, paths.staged);
      stagedLinkCreated = true;
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) throw error;
      const concurrentMatches = await exactControlFile(
        paths.staged,
        content,
        boundary.processUserId,
        boundary.processGroupId,
        0o400,
      );
      if (concurrentMatches !== true) {
        if (concurrentMatches === false) {
          throw new OwnerKemerbetReadinessCohortRejectedError();
        }
        throw new OwnerKemerbetReadinessCohortUnavailableError();
      }
      await unlinkOwnedInstallingFile(paths.installing, installingHandle, installingIdentity, 0);
      installingOwned = false;
      await installingHandle.close();
      installingHandle = undefined;
      await syncControlRoot(boundary, rootBefore);
      await assertExactServiceFile(boundary, paths.staged, content);
      await assertPathAbsent(paths.installing);
      return true;
    }
    await unlinkOwnedInstallingFile(paths.installing, installingHandle, installingIdentity, 1);
    installingOwned = false;
    await installingHandle.close();
    installingHandle = undefined;
    await syncControlRoot(boundary, rootBefore);
    await assertExactServiceFile(boundary, paths.staged, content);
    await assertPathAbsent(paths.installing);
    return false;
  } catch (error) {
    if (installingOwned && installingHandle) {
      const cleanupIdentity =
        installingIdentity ?? (await installingHandle.stat().catch(() => undefined));
      if (cleanupIdentity) {
        await unlinkOwnedInstallingFile(
          paths.installing,
          installingHandle,
          cleanupIdentity,
          stagedLinkCreated ? 1 : 0,
        ).catch(() => undefined);
      }
    }
    if (installingHandle) await installingHandle.close().catch(() => undefined);
    throw error;
  }
}

function receipt(alreadyPrepared: boolean): OwnerKemerbetReadinessCohortReceipt {
  return {
    alreadyPrepared,
    identifiersRedacted: true,
    moneyMoved: false,
    playersPrepared: 5,
    transferDisabled: true,
  };
}

export class FileOwnerKemerbetReadinessCohortControl implements OwnerKemerbetReadinessCohortControl {
  private readonly boundary: OwnerKemerbetReadinessFileBoundary;
  private preparationTail: Promise<void> = Promise.resolve();

  constructor();
  constructor(
    token: typeof LINUX_TEST_BOUNDARY_TOKEN,
    boundary: OwnerKemerbetReadinessFileBoundary,
  );
  constructor(
    token?: typeof LINUX_TEST_BOUNDARY_TOKEN,
    boundary?: OwnerKemerbetReadinessFileBoundary,
  ) {
    if (token === undefined && boundary === undefined) {
      this.boundary = PRODUCTION_FILE_BOUNDARY;
      return;
    }
    if (token !== LINUX_TEST_BOUNDARY_TOKEN || !boundary) {
      throw new OwnerKemerbetReadinessCohortUnavailableError();
    }
    this.boundary = boundary;
  }

  private assertProcessIdentity(): void {
    const effectiveUserId = process.geteuid?.();
    const effectiveGroupId = process.getegid?.();
    if (
      effectiveUserId !== this.boundary.processUserId ||
      effectiveGroupId !== this.boundary.processGroupId
    ) {
      throw new OwnerKemerbetReadinessCohortUnavailableError();
    }
  }

  async rootReceipt(): Promise<OwnerKemerbetReadinessRootReceipt | undefined> {
    this.assertProcessIdentity();
    try {
      const rootBefore = await assertControlRoot(this.boundary);
      const first = await readRootClaimMarkerSet(this.boundary);
      if (first) await assertReceiptStageState(this.boundary, first);
      const second = await readRootClaimMarkerSet(this.boundary);
      if (!sameRootClaimMarker(first, second)) {
        throw new OwnerKemerbetReadinessCohortUnavailableError();
      }
      if (second) await assertReceiptStageState(this.boundary, second);
      if (!sameControlRoot(rootBefore, await assertControlRoot(this.boundary))) {
        throw new OwnerKemerbetReadinessCohortUnavailableError();
      }
      return second ? { claimId: second.claimId, event: second.event } : undefined;
    } catch (error) {
      if (
        error instanceof OwnerKemerbetReadinessCohortRejectedError ||
        error instanceof OwnerKemerbetReadinessCohortUnavailableError
      ) {
        throw error;
      }
      throw new OwnerKemerbetReadinessCohortUnavailableError();
    }
  }

  async completed(claimId: string): Promise<boolean> {
    if (!RECORD_ID_PATTERN.test(claimId)) {
      throw new OwnerKemerbetReadinessCohortRejectedError();
    }
    const rootReceipt = await this.rootReceipt();
    if (!rootReceipt) return false;
    if (rootReceipt.claimId !== claimId) {
      throw new OwnerKemerbetReadinessCohortRejectedError();
    }
    return rootReceipt.event === 'completed';
  }

  async prepare(
    players: readonly OwnerPlayerDepositEligibilityRecord[],
    requestId: string,
    claimId: string,
  ): Promise<OwnerKemerbetReadinessCohortReceipt> {
    if (!REQUEST_ID_PATTERN.test(requestId) || !RECORD_ID_PATTERN.test(claimId)) {
      throw new OwnerKemerbetReadinessCohortRejectedError();
    }
    const content = deriveOwnerKemerbetReadinessCohortFile(players);
    const claimContent = exactUuidContent(claimId);
    this.assertProcessIdentity();
    const predecessor = this.preparationTail;
    let releasePreparation!: () => void;
    this.preparationTail = new Promise<void>((resolvePreparation) => {
      releasePreparation = resolvePreparation;
    });
    await predecessor;
    try {
      const rootBefore = await assertControlRoot(this.boundary);
      await Promise.all([
        assertPathAbsent(this.boundary.importedClaim),
        assertPathAbsent(this.boundary.installingImportedClaim),
        assertPathAbsent(this.boundary.completedClaim),
        assertPathAbsent(this.boundary.installingCompletedClaim),
        assertPathAbsent(this.boundary.failedClaim),
        assertPathAbsent(this.boundary.installingFailedClaim),
      ]);
      await assertInitialPairTopology(this.boundary);
      const claimAlreadyStaged = await installStagedControlFile(
        this.boundary,
        { installing: this.boundary.installingClaim, staged: this.boundary.stagedClaim },
        claimContent,
        rootBefore,
      );
      const cohortAlreadyStaged = await installStagedControlFile(
        this.boundary,
        { installing: this.boundary.installingCohort, staged: this.boundary.stagedCohort },
        content,
        rootBefore,
      );
      if (!claimAlreadyStaged && cohortAlreadyStaged) {
        throw new OwnerKemerbetReadinessCohortUnavailableError();
      }
      await assertExactServiceFile(this.boundary, this.boundary.stagedClaim, claimContent);
      await assertExactServiceFile(this.boundary, this.boundary.stagedCohort, content);
      await assertPathAbsent(this.boundary.installingClaim);
      await assertPathAbsent(this.boundary.installingCohort);
      const rootAfter = await assertControlRoot(this.boundary);
      if (!sameControlRoot(rootBefore, rootAfter)) {
        throw new OwnerKemerbetReadinessCohortUnavailableError();
      }
      return receipt(claimAlreadyStaged && cohortAlreadyStaged);
    } catch (error) {
      if (
        error instanceof OwnerKemerbetReadinessCohortRejectedError ||
        error instanceof OwnerKemerbetReadinessCohortUnavailableError
      ) {
        throw error;
      }
      throw new OwnerKemerbetReadinessCohortUnavailableError();
    } finally {
      releasePreparation();
    }
  }
}

/**
 * Linux-only integration seam. Production callers cannot supply an alternate
 * root or identity: the unforgeable token is module-private and this factory
 * is disabled outside tests and outside the OS temporary directory.
 */
export function createFileOwnerKemerbetReadinessCohortControlForLinuxTests(
  controlRoot: string,
): FileOwnerKemerbetReadinessCohortControl {
  const effectiveUserId = process.geteuid?.();
  const effectiveGroupId = process.getegid?.();
  const temporaryRoot = resolve(tmpdir());
  const candidate = resolve(controlRoot);
  const relativeCandidate = relative(temporaryRoot, candidate);
  if (
    process.env.NODE_ENV !== 'test' ||
    process.platform !== 'linux' ||
    effectiveUserId === undefined ||
    effectiveGroupId === undefined ||
    !isAbsolute(controlRoot) ||
    candidate !== controlRoot ||
    candidate === temporaryRoot ||
    relativeCandidate.startsWith('..') ||
    isAbsolute(relativeCandidate)
  ) {
    throw new OwnerKemerbetReadinessCohortUnavailableError();
  }
  return new FileOwnerKemerbetReadinessCohortControl(
    LINUX_TEST_BOUNDARY_TOKEN,
    fileBoundary(
      candidate,
      effectiveUserId,
      effectiveGroupId,
      effectiveUserId,
      effectiveGroupId,
      effectiveUserId,
      effectiveGroupId,
    ),
  );
}
