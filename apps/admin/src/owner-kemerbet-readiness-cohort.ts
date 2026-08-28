import { timingSafeEqual } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { link, lstat, open, readdir, realpath, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';

import type { OwnerPlayerDepositEligibilityRecord } from './owner-player-deposit-eligibility.js';

const CONTROL_ROOT = '/run/fetanagent-kemerbet-session-control';
const RECEIPT_ROOT = '/run/fetanagent-kemerbet-readiness-cohort-receipts';
const STAGED_COHORT = `${CONTROL_ROOT}/kemerbet-readiness-player-ids.stage-v1`;
const INSTALLING_COHORT = `${CONTROL_ROOT}/.kemerbet-readiness-player-ids.stage-v1.installing`;
const STAGED_CLAIM = `${CONTROL_ROOT}/kemerbet-readiness-cohort-claim.stage-v1`;
const INSTALLING_CLAIM = `${CONTROL_ROOT}/.kemerbet-readiness-cohort-claim.stage-v1.installing`;
const IMPORTED_CLAIM = `${RECEIPT_ROOT}/kemerbet-readiness-cohort-imported-v1`;
const INSTALLING_IMPORTED_CLAIM = `${RECEIPT_ROOT}/.kemerbet-readiness-cohort-imported-v1.installing`;
const COMPLETED_CLAIM = `${RECEIPT_ROOT}/kemerbet-readiness-cohort-completed-v1`;
const INSTALLING_COMPLETED_CLAIM = `${RECEIPT_ROOT}/.kemerbet-readiness-cohort-completed-v1.installing`;
const FAILED_CLAIM = `${RECEIPT_ROOT}/kemerbet-readiness-cohort-failed-v1`;
const INSTALLING_FAILED_CLAIM = `${RECEIPT_ROOT}/.kemerbet-readiness-cohort-failed-v1.installing`;
const SECURITY_RECOVERY_FAILED_TERMINAL_CLAIM = `${RECEIPT_ROOT}/kemerbet-readiness-cohort-security-recovery-failed-terminal-v1`;
const INSTALLING_SECURITY_RECOVERY_FAILED_TERMINAL_CLAIM = `${RECEIPT_ROOT}/.kemerbet-readiness-cohort-security-recovery-failed-terminal-v1.installing`;
const SECURITY_RECOVERY_PROFILE_FINALIZED_CLAIM = `${RECEIPT_ROOT}/kemerbet-readiness-cohort-security-recovery-profile-finalized-v1`;
const INSTALLING_SECURITY_RECOVERY_PROFILE_FINALIZED_CLAIM = `${RECEIPT_ROOT}/.kemerbet-readiness-cohort-security-recovery-profile-finalized-v1.installing`;
const RECHECK_AUTHORIZATION_SPENT_FAILED_TERMINAL_CLAIM = `${RECEIPT_ROOT}/kemerbet-readiness-cohort-recheck-authorization-spent-failed-terminal-v1`;
const INSTALLING_RECHECK_AUTHORIZATION_SPENT_FAILED_TERMINAL_CLAIM = `${RECEIPT_ROOT}/.kemerbet-readiness-cohort-recheck-authorization-spent-failed-terminal-v1.installing`;
const SECURITY_RECOVERY_PROFILE_ACK = `${CONTROL_ROOT}/kemerbet-quarantine-recovery-profile-prepared-v1`;
const INSTALLING_SECURITY_RECOVERY_PROFILE_ACK = `${CONTROL_ROOT}/.kemerbet-quarantine-recovery-profile-prepared-v1.installing`;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RECORD_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PLAYER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const EXPECTED_EFFECTIVE_USER_ID = 10_001;
const EXPECTED_EFFECTIVE_GROUP_ID = 10_001;
const MAX_COHORT_BYTES = 1_024;
const RECEIPT_BASENAMES = new Set([
  'kemerbet-readiness-cohort-imported-v1',
  '.kemerbet-readiness-cohort-imported-v1.installing',
  'kemerbet-readiness-cohort-completed-v1',
  '.kemerbet-readiness-cohort-completed-v1.installing',
  'kemerbet-readiness-cohort-failed-v1',
  '.kemerbet-readiness-cohort-failed-v1.installing',
  'kemerbet-readiness-cohort-security-recovery-failed-terminal-v1',
  '.kemerbet-readiness-cohort-security-recovery-failed-terminal-v1.installing',
  'kemerbet-readiness-cohort-security-recovery-profile-finalized-v1',
  '.kemerbet-readiness-cohort-security-recovery-profile-finalized-v1.installing',
  'kemerbet-readiness-cohort-recheck-authorization-spent-failed-terminal-v1',
  '.kemerbet-readiness-cohort-recheck-authorization-spent-failed-terminal-v1.installing',
]);
const RECOVERY_BLOCKING_BASENAMES = new Set([
  'kemerbet-readiness-recovery-in-progress-or-failed-v1',
  '.kemerbet-readiness-recovery-in-progress-or-failed-v1.installing',
]);

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
  readonly installingSecurityRecoveryFailedTerminalClaim: string;
  readonly installingSecurityRecoveryProfileFinalizedClaim: string;
  readonly installingRecheckAuthorizationSpentFailedTerminalClaim: string;
  readonly installingSecurityRecoveryProfileAcknowledgment: string;
  readonly processGroupId: number;
  readonly processUserId: number;
  readonly receiptRoot: string;
  readonly receiptRootGroupId: number;
  readonly receiptRootMode: number;
  readonly receiptRootUserId: number;
  readonly stagedClaim: string;
  readonly stagedCohort: string;
  readonly securityRecoveryFailedTerminalClaim: string;
  readonly securityRecoveryProfileFinalizedClaim: string;
  readonly recheckAuthorizationSpentFailedTerminalClaim: string;
  readonly securityRecoveryProfileAcknowledgment: string;
  readonly completedClaimGroupId: number;
  readonly completedClaimUserId: number;
  readonly frozenStageGroupId: number;
  readonly frozenStageUserId: number;
}

function fileBoundary(
  controlRoot: string,
  receiptRoot: string,
  processUserId: number,
  processGroupId: number,
  completedClaimUserId: number,
  completedClaimGroupId: number,
  frozenStageUserId: number,
  frozenStageGroupId: number,
  receiptRootUserId: number,
  receiptRootGroupId: number,
  receiptRootMode: number,
): OwnerKemerbetReadinessFileBoundary {
  return {
    completedClaim: `${receiptRoot}/kemerbet-readiness-cohort-completed-v1`,
    completedClaimGroupId,
    completedClaimUserId,
    controlRoot,
    failedClaim: `${receiptRoot}/kemerbet-readiness-cohort-failed-v1`,
    frozenStageGroupId,
    frozenStageUserId,
    importedClaim: `${receiptRoot}/kemerbet-readiness-cohort-imported-v1`,
    installingClaim: `${controlRoot}/.kemerbet-readiness-cohort-claim.stage-v1.installing`,
    installingCohort: `${controlRoot}/.kemerbet-readiness-player-ids.stage-v1.installing`,
    installingCompletedClaim: `${receiptRoot}/.kemerbet-readiness-cohort-completed-v1.installing`,
    installingFailedClaim: `${receiptRoot}/.kemerbet-readiness-cohort-failed-v1.installing`,
    installingImportedClaim: `${receiptRoot}/.kemerbet-readiness-cohort-imported-v1.installing`,
    installingSecurityRecoveryFailedTerminalClaim: `${receiptRoot}/.kemerbet-readiness-cohort-security-recovery-failed-terminal-v1.installing`,
    installingSecurityRecoveryProfileFinalizedClaim: `${receiptRoot}/.kemerbet-readiness-cohort-security-recovery-profile-finalized-v1.installing`,
    installingRecheckAuthorizationSpentFailedTerminalClaim: `${receiptRoot}/.kemerbet-readiness-cohort-recheck-authorization-spent-failed-terminal-v1.installing`,
    installingSecurityRecoveryProfileAcknowledgment: `${controlRoot}/.kemerbet-quarantine-recovery-profile-prepared-v1.installing`,
    processGroupId,
    processUserId,
    receiptRoot,
    receiptRootGroupId,
    receiptRootMode,
    receiptRootUserId,
    stagedClaim: `${controlRoot}/kemerbet-readiness-cohort-claim.stage-v1`,
    stagedCohort: `${controlRoot}/kemerbet-readiness-player-ids.stage-v1`,
    securityRecoveryFailedTerminalClaim: `${receiptRoot}/kemerbet-readiness-cohort-security-recovery-failed-terminal-v1`,
    securityRecoveryProfileFinalizedClaim: `${receiptRoot}/kemerbet-readiness-cohort-security-recovery-profile-finalized-v1`,
    recheckAuthorizationSpentFailedTerminalClaim: `${receiptRoot}/kemerbet-readiness-cohort-recheck-authorization-spent-failed-terminal-v1`,
    securityRecoveryProfileAcknowledgment: `${controlRoot}/kemerbet-quarantine-recovery-profile-prepared-v1`,
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
  installingSecurityRecoveryFailedTerminalClaim: INSTALLING_SECURITY_RECOVERY_FAILED_TERMINAL_CLAIM,
  installingSecurityRecoveryProfileFinalizedClaim:
    INSTALLING_SECURITY_RECOVERY_PROFILE_FINALIZED_CLAIM,
  installingRecheckAuthorizationSpentFailedTerminalClaim:
    INSTALLING_RECHECK_AUTHORIZATION_SPENT_FAILED_TERMINAL_CLAIM,
  installingSecurityRecoveryProfileAcknowledgment: INSTALLING_SECURITY_RECOVERY_PROFILE_ACK,
  processGroupId: EXPECTED_EFFECTIVE_GROUP_ID,
  processUserId: EXPECTED_EFFECTIVE_USER_ID,
  receiptRoot: RECEIPT_ROOT,
  receiptRootGroupId: 0,
  receiptRootMode: 0o755,
  receiptRootUserId: 0,
  stagedClaim: STAGED_CLAIM,
  stagedCohort: STAGED_COHORT,
  securityRecoveryFailedTerminalClaim: SECURITY_RECOVERY_FAILED_TERMINAL_CLAIM,
  securityRecoveryProfileFinalizedClaim: SECURITY_RECOVERY_PROFILE_FINALIZED_CLAIM,
  recheckAuthorizationSpentFailedTerminalClaim: RECHECK_AUTHORIZATION_SPENT_FAILED_TERMINAL_CLAIM,
  securityRecoveryProfileAcknowledgment: SECURITY_RECOVERY_PROFILE_ACK,
};
const LINUX_TEST_BOUNDARY_TOKEN: unique symbol = Symbol('linux-test-boundary');

export interface OwnerKemerbetReadinessCohortReceipt {
  readonly alreadyPrepared: boolean;
  readonly identifiersRedacted: true;
  readonly moneyMoved: false;
  readonly playersPrepared: 5;
  readonly transferDisabled: true;
}

export type OwnerKemerbetReadinessRootReceiptEvent =
  | 'completed'
  | 'imported'
  | 'retryable_failed'
  | 'recheck_authorization_spent_failed_terminal'
  | 'security_recovery_failed_terminal'
  | 'security_recovery_profile_finalized';

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
  acknowledgeSecurityRecovery?(
    acknowledgment: OwnerKemerbetSecurityRecoveryAcknowledgment,
  ): Promise<OwnerKemerbetSecurityRecoveryAcknowledgmentReceipt>;
  completed(claimId: string): Promise<boolean>;
  lifecycle?(): Promise<OwnerKemerbetReadinessLifecycleState>;
  prepare(
    players: readonly OwnerPlayerDepositEligibilityRecord[],
    requestId: string,
    claimId: string,
  ): Promise<OwnerKemerbetReadinessCohortReceipt>;
  rootReceipt(): Promise<OwnerKemerbetReadinessRootReceipt | undefined>;
}

export type OwnerKemerbetReadinessLifecycleState =
  | 'completed'
  | 'empty'
  | 'imported'
  | 'retryable_failed'
  | 'recheck_authorization_spent_failed_terminal'
  | 'security_recovery_failed_terminal'
  | 'security_recovery_cohort_staged'
  | 'security_recovery_profile_finalized'
  | 'staged';

export interface OwnerKemerbetSecurityRecoveryAcknowledgment {
  readonly claimId: string;
  readonly platformAgentAccountId: string;
  readonly profileRevision: number;
  readonly receiptId: string;
}

export interface OwnerKemerbetSecurityRecoveryAcknowledgmentReceipt {
  readonly alreadyAcknowledged: boolean;
  readonly identifiersRedacted: true;
  readonly moneyMoved: false;
  readonly transferDisabled: true;
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

async function assertReceiptRoot(boundary: OwnerKemerbetReadinessFileBoundary): Promise<Stats> {
  const before = await lstat(boundary.receiptRoot);
  if (
    boundary.receiptRoot === boundary.controlRoot ||
    !before.isDirectory() ||
    before.isSymbolicLink() ||
    before.uid !== boundary.receiptRootUserId ||
    before.gid !== boundary.receiptRootGroupId ||
    (before.mode & 0o7777) !== boundary.receiptRootMode ||
    (await realpath(boundary.receiptRoot)) !== boundary.receiptRoot
  ) {
    throw new OwnerKemerbetReadinessCohortUnavailableError();
  }
  const after = await lstat(boundary.receiptRoot);
  if (!sameControlRoot(before, after)) {
    throw new OwnerKemerbetReadinessCohortUnavailableError();
  }
  return after;
}

async function assertReceiptNamespace(boundary: OwnerKemerbetReadinessFileBoundary): Promise<void> {
  const entries = await readdir(boundary.receiptRoot);
  if (
    entries.length > RECEIPT_BASENAMES.size ||
    entries.some((entry) => RECOVERY_BLOCKING_BASENAMES.has(entry) || !RECEIPT_BASENAMES.has(entry))
  ) {
    throw new OwnerKemerbetReadinessCohortUnavailableError();
  }
}

async function assertPrepareReceiptPaths(
  boundary: OwnerKemerbetReadinessFileBoundary,
  allowedRecoveryMarker: RootClaimMarker | undefined,
): Promise<void> {
  await Promise.all([
    assertPathAbsent(boundary.importedClaim),
    assertPathAbsent(boundary.installingImportedClaim),
    assertPathAbsent(boundary.completedClaim),
    assertPathAbsent(boundary.installingCompletedClaim),
    assertPathAbsent(boundary.failedClaim),
    assertPathAbsent(boundary.installingFailedClaim),
    assertPathAbsent(boundary.securityRecoveryFailedTerminalClaim),
    assertPathAbsent(boundary.installingSecurityRecoveryFailedTerminalClaim),
    assertPathAbsent(boundary.installingSecurityRecoveryProfileFinalizedClaim),
    assertPathAbsent(boundary.recheckAuthorizationSpentFailedTerminalClaim),
    assertPathAbsent(boundary.installingRecheckAuthorizationSpentFailedTerminalClaim),
    assertPathAbsent(boundary.securityRecoveryProfileAcknowledgment),
    assertPathAbsent(boundary.installingSecurityRecoveryProfileAcknowledgment),
  ]);
  const currentRecoveryMarker = await readRootClaimMarker(
    boundary,
    boundary.securityRecoveryProfileFinalizedClaim,
    'security_recovery_profile_finalized',
  );
  if (!sameRootClaimMarker(allowedRecoveryMarker, currentRecoveryMarker)) {
    throw new OwnerKemerbetReadinessCohortUnavailableError();
  }
}

async function assertLegacyReceiptPathsAbsent(
  boundary: OwnerKemerbetReadinessFileBoundary,
): Promise<void> {
  await Promise.all(
    [...RECEIPT_BASENAMES].map((basename) =>
      assertPathAbsent(`${boundary.controlRoot}/${basename}`),
    ),
  );
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

function securityRecoveryAcknowledgmentContent(
  acknowledgment: OwnerKemerbetSecurityRecoveryAcknowledgment,
): Buffer {
  if (
    !RECORD_ID_PATTERN.test(acknowledgment.claimId) ||
    !RECORD_ID_PATTERN.test(acknowledgment.receiptId) ||
    !RECORD_ID_PATTERN.test(acknowledgment.platformAgentAccountId) ||
    !Number.isSafeInteger(acknowledgment.profileRevision) ||
    acknowledgment.profileRevision < 1
  ) {
    throw new OwnerKemerbetReadinessCohortRejectedError();
  }
  return Buffer.from(
    [
      'version=1',
      `claim_id=${acknowledgment.claimId}`,
      `receipt_id=${acknowledgment.receiptId}`,
      'platform_code=kemerbet',
      `platform_agent_account_id=${acknowledgment.platformAgentAccountId}`,
      `profile_revision=${String(acknowledgment.profileRevision)}`,
      'configuration_reason=security_recovery',
      'transfer_disabled=true',
      'money_moved=false',
      '',
    ].join('\n'),
    'ascii',
  );
}

async function assertSecurityRecoveryAcknowledgmentState(
  boundary: OwnerKemerbetReadinessFileBoundary,
  marker: RootClaimMarker | undefined,
): Promise<void> {
  let installingHandle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    installingHandle = await open(
      boundary.installingSecurityRecoveryProfileAcknowledgment,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) {
      throw new OwnerKemerbetReadinessCohortUnavailableError();
    }
  }
  if (installingHandle) {
    try {
      if (marker?.event !== 'security_recovery_failed_terminal') {
        throw new OwnerKemerbetReadinessCohortUnavailableError();
      }
      const opened = await installingHandle.stat();
      const installingStat = await lstat(boundary.installingSecurityRecoveryProfileAcknowledgment);
      if (
        !opened.isFile() ||
        installingStat.isSymbolicLink() ||
        !sameFileIdentity(opened, installingStat) ||
        opened.uid !== boundary.processUserId ||
        opened.gid !== boundary.processGroupId ||
        (opened.mode & 0o7777) !== 0o400 ||
        (opened.nlink !== 1 && opened.nlink !== 2) ||
        opened.size > 512
      ) {
        throw new OwnerKemerbetReadinessCohortUnavailableError();
      }
      const acknowledgmentStat = await lstat(boundary.securityRecoveryProfileAcknowledgment).catch(
        (error: unknown) => {
          if (hasErrorCode(error, 'ENOENT')) return undefined;
          throw error;
        },
      );
      if (
        (opened.nlink === 1 && acknowledgmentStat !== undefined) ||
        (opened.nlink === 2 &&
          (!acknowledgmentStat ||
            acknowledgmentStat.isSymbolicLink() ||
            !sameFileIdentity(opened, acknowledgmentStat) ||
            acknowledgmentStat.nlink !== 2))
      ) {
        throw new OwnerKemerbetReadinessCohortUnavailableError();
      }
      return;
    } finally {
      await installingHandle.close();
    }
  }
  const acknowledgment = await readExactControlFile(
    boundary.securityRecoveryProfileAcknowledgment,
    boundary.processUserId,
    boundary.processGroupId,
    0o400,
    1,
    200,
    512,
  );
  if (!acknowledgment) return;
  if (marker?.event !== 'security_recovery_failed_terminal') {
    throw new OwnerKemerbetReadinessCohortUnavailableError();
  }
  const decoded = acknowledgment.content.toString('ascii');
  if (!exactContent(Buffer.from(decoded, 'ascii'), acknowledgment.content)) {
    throw new OwnerKemerbetReadinessCohortRejectedError();
  }
  const match =
    /^version=1\nclaim_id=([0-9a-f-]{36})\nreceipt_id=([0-9a-f-]{36})\nplatform_code=kemerbet\nplatform_agent_account_id=([0-9a-f-]{36})\nprofile_revision=([1-9][0-9]{0,8})\nconfiguration_reason=security_recovery\ntransfer_disabled=true\nmoney_moved=false\n$/u.exec(
      decoded,
    );
  const profileRevision = match ? Number(match[4]) : Number.NaN;
  if (
    !match ||
    match[1] !== marker.claimId ||
    !RECORD_ID_PATTERN.test(match[2]!) ||
    !RECORD_ID_PATTERN.test(match[3]!) ||
    !Number.isSafeInteger(profileRevision) ||
    profileRevision < 1
  ) {
    throw new OwnerKemerbetReadinessCohortRejectedError();
  }
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
  readonly coexistingSecurityRecoveryProfileFinalizedLatch?: RootClaimMarker;
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
    assertPathAbsent(boundary.installingSecurityRecoveryFailedTerminalClaim),
    assertPathAbsent(boundary.installingSecurityRecoveryProfileFinalizedClaim),
    assertPathAbsent(boundary.installingRecheckAuthorizationSpentFailedTerminalClaim),
  ]);
  const markers = (
    await Promise.all([
      readRootClaimMarker(boundary, boundary.importedClaim, 'imported'),
      readRootClaimMarker(boundary, boundary.completedClaim, 'completed'),
      readRootClaimMarker(boundary, boundary.failedClaim, 'retryable_failed'),
      readRootClaimMarker(
        boundary,
        boundary.securityRecoveryFailedTerminalClaim,
        'security_recovery_failed_terminal',
      ),
      readRootClaimMarker(
        boundary,
        boundary.securityRecoveryProfileFinalizedClaim,
        'security_recovery_profile_finalized',
      ),
      readRootClaimMarker(
        boundary,
        boundary.recheckAuthorizationSpentFailedTerminalClaim,
        'recheck_authorization_spent_failed_terminal',
      ),
    ])
  ).filter((marker): marker is RootClaimMarker => marker !== undefined);
  if (markers.length === 2) {
    // The helper can durably terminalize a spent fresh claim before retiring the
    // prior recovery-profile latch. This is the only valid two-marker crash
    // prefix: preserve both inode identities, but project the fresh claim as
    // permanently spent so no retry or cohort preparation can be authorized.
    const spentTerminal = markers.find(
      (marker) => marker.event === 'recheck_authorization_spent_failed_terminal',
    );
    const profileFinalizedLatch = markers.find(
      (marker) => marker.event === 'security_recovery_profile_finalized',
    );
    if (
      !spentTerminal ||
      !profileFinalizedLatch ||
      spentTerminal.claimId === profileFinalizedLatch.claimId
    ) {
      throw new OwnerKemerbetReadinessCohortUnavailableError();
    }
    return {
      ...spentTerminal,
      coexistingSecurityRecoveryProfileFinalizedLatch: profileFinalizedLatch,
    };
  }
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
  const leftLatch = left.coexistingSecurityRecoveryProfileFinalizedLatch;
  const rightLatch = right.coexistingSecurityRecoveryProfileFinalizedLatch;
  const sameLatch =
    leftLatch && rightLatch
      ? leftLatch.claimId === rightLatch.claimId &&
        leftLatch.event === rightLatch.event &&
        sameFileIdentity(leftLatch.identity, rightLatch.identity) &&
        leftLatch.identity.nlink === rightLatch.identity.nlink
      : leftLatch === rightLatch;
  return (
    sameLatch &&
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

type UnreceiptedStagePhase = 'frozen' | 'raw';

interface ExactUnreceiptedStageFileRead extends ExactControlFileRead {
  readonly phase: UnreceiptedStagePhase;
}

async function readExactUnreceiptedStageFile(
  boundary: OwnerKemerbetReadinessFileBoundary,
  path: string,
  minimumBytes: number,
  maximumBytes: number,
): Promise<ExactUnreceiptedStageFileRead | undefined> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return undefined;
    throw new OwnerKemerbetReadinessCohortUnavailableError();
  }
  try {
    const before = await handle.stat();
    const raw =
      before.uid === boundary.processUserId &&
      before.gid === boundary.processGroupId &&
      (before.mode & 0o7777) === 0o400;
    const frozen =
      before.uid === boundary.frozenStageUserId &&
      before.gid === boundary.frozenStageGroupId &&
      (before.mode & 0o7777) === 0o444;
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      (!raw && !frozen) ||
      before.nlink !== 1 ||
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
    const pathStat = await lstat(path);
    if (
      !sameFileIdentity(before, after) ||
      after.nlink !== before.nlink ||
      pathStat.isSymbolicLink() ||
      !sameFileIdentity(before, pathStat) ||
      pathStat.nlink !== before.nlink
    ) {
      throw new OwnerKemerbetReadinessCohortUnavailableError();
    }
    return { content, identity: after, phase: raw ? 'raw' : 'frozen' };
  } finally {
    await handle.close();
  }
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
      assertPathAbsent(boundary.securityRecoveryFailedTerminalClaim),
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
  if (marker.event === 'security_recovery_failed_terminal') {
    await Promise.all([
      assertPathAbsent(boundary.stagedClaim),
      assertPathAbsent(boundary.stagedCohort),
      assertPathAbsent(boundary.importedClaim),
      assertPathAbsent(boundary.completedClaim),
      assertPathAbsent(boundary.failedClaim),
    ]);
    return;
  }
  if (marker.event === 'recheck_authorization_spent_failed_terminal') {
    const profileFinalizedLatch = marker.coexistingSecurityRecoveryProfileFinalizedLatch;
    if (
      profileFinalizedLatch &&
      (profileFinalizedLatch.event !== 'security_recovery_profile_finalized' ||
        profileFinalizedLatch.claimId === marker.claimId)
    ) {
      throw new OwnerKemerbetReadinessCohortUnavailableError();
    }
    await Promise.all([
      assertPathAbsent(boundary.stagedClaim),
      assertPathAbsent(boundary.stagedCohort),
      assertPathAbsent(boundary.importedClaim),
      assertPathAbsent(boundary.completedClaim),
      assertPathAbsent(boundary.failedClaim),
      assertPathAbsent(boundary.securityRecoveryFailedTerminalClaim),
      ...(profileFinalizedLatch
        ? []
        : [assertPathAbsent(boundary.securityRecoveryProfileFinalizedClaim)]),
    ]);
    return;
  }
  if (marker.event === 'security_recovery_profile_finalized') {
    await Promise.all([
      assertPathAbsent(boundary.importedClaim),
      assertPathAbsent(boundary.completedClaim),
      assertPathAbsent(boundary.failedClaim),
      assertPathAbsent(boundary.securityRecoveryFailedTerminalClaim),
    ]);
    return;
  }
  await Promise.all([
    assertPathAbsent(boundary.completedClaim),
    assertPathAbsent(boundary.failedClaim),
    assertPathAbsent(boundary.securityRecoveryFailedTerminalClaim),
  ]);
  await assertImportedStageState(boundary, marker.claimId);
}

interface UnreceiptedLifecycleInspection {
  readonly claimIdentity?: Stats;
  readonly claimContent?: Buffer;
  readonly cohortIdentity?: Stats;
  readonly cohortContent?: Buffer;
  readonly phase?: UnreceiptedStagePhase;
  readonly state: 'empty' | 'security_recovery_cohort_staged' | 'staged';
}

async function inspectUnreceiptedLifecycle(
  boundary: OwnerKemerbetReadinessFileBoundary,
): Promise<UnreceiptedLifecycleInspection> {
  await Promise.all([
    assertPathAbsent(boundary.installingClaim),
    assertPathAbsent(boundary.installingCohort),
  ]);
  const [claim, cohort] = await Promise.all([
    readExactUnreceiptedStageFile(boundary, boundary.stagedClaim, 37, 37),
    readExactUnreceiptedStageFile(boundary, boundary.stagedCohort, 10, MAX_COHORT_BYTES),
  ]);
  if (!claim && !cohort) return { state: 'empty' };
  if (!claim || !cohort) throw new OwnerKemerbetReadinessCohortUnavailableError();
  if (claim.phase !== cohort.phase) {
    throw new OwnerKemerbetReadinessCohortUnavailableError();
  }
  const claimId = claim.content.subarray(0, 36).toString('ascii');
  if (!RECORD_ID_PATTERN.test(claimId) || !exactContent(claim.content, exactUuidContent(claimId))) {
    throw new OwnerKemerbetReadinessCohortRejectedError();
  }
  validateCohortContent(cohort.content);
  return {
    claimContent: claim.content,
    claimIdentity: claim.identity,
    cohortContent: cohort.content,
    cohortIdentity: cohort.identity,
    phase: claim.phase,
    state: claim.phase === 'frozen' ? 'security_recovery_cohort_staged' : 'staged',
  };
}

function sameStageInode(left: Stats, right: Stats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.nlink === right.nlink
  );
}

function sameUnreceiptedLifecycle(
  left: UnreceiptedLifecycleInspection | undefined,
  right: UnreceiptedLifecycleInspection | undefined,
): boolean {
  if (!left || !right) return left === right;
  if (left.state === 'empty' || right.state === 'empty') return left.state === right.state;
  return (
    !!left.claimContent &&
    !!right.claimContent &&
    !!left.claimIdentity &&
    !!right.claimIdentity &&
    !!left.cohortContent &&
    !!right.cohortContent &&
    !!left.cohortIdentity &&
    !!right.cohortIdentity &&
    !!left.phase &&
    !!right.phase &&
    (left.phase === right.phase || (left.phase === 'raw' && right.phase === 'frozen')) &&
    sameStageInode(left.claimIdentity, right.claimIdentity) &&
    sameStageInode(left.cohortIdentity, right.cohortIdentity) &&
    exactContent(left.claimContent, right.claimContent) &&
    exactContent(left.cohortContent, right.cohortContent)
  );
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
  private readonly afterLifecycleInspectionForLinuxTest: (() => Promise<void>) | undefined;
  private readonly afterStagingForLinuxTest: (() => Promise<void>) | undefined;
  private readonly boundary: OwnerKemerbetReadinessFileBoundary;
  private preparationTail: Promise<void> = Promise.resolve();

  constructor();
  constructor(
    token: typeof LINUX_TEST_BOUNDARY_TOKEN,
    boundary: OwnerKemerbetReadinessFileBoundary,
    afterStagingForLinuxTest?: () => Promise<void>,
    afterLifecycleInspectionForLinuxTest?: () => Promise<void>,
  );
  constructor(
    token?: typeof LINUX_TEST_BOUNDARY_TOKEN,
    boundary?: OwnerKemerbetReadinessFileBoundary,
    afterStagingForLinuxTest?: () => Promise<void>,
    afterLifecycleInspectionForLinuxTest?: () => Promise<void>,
  ) {
    if (
      token === undefined &&
      boundary === undefined &&
      afterStagingForLinuxTest === undefined &&
      afterLifecycleInspectionForLinuxTest === undefined
    ) {
      this.afterLifecycleInspectionForLinuxTest = undefined;
      this.afterStagingForLinuxTest = undefined;
      this.boundary = PRODUCTION_FILE_BOUNDARY;
      return;
    }
    if (token !== LINUX_TEST_BOUNDARY_TOKEN || !boundary) {
      throw new OwnerKemerbetReadinessCohortUnavailableError();
    }
    this.boundary = boundary;
    this.afterStagingForLinuxTest = afterStagingForLinuxTest;
    this.afterLifecycleInspectionForLinuxTest = afterLifecycleInspectionForLinuxTest;
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

  async acknowledgeSecurityRecovery(
    acknowledgment: OwnerKemerbetSecurityRecoveryAcknowledgment,
  ): Promise<OwnerKemerbetSecurityRecoveryAcknowledgmentReceipt> {
    const content = securityRecoveryAcknowledgmentContent(acknowledgment);
    this.assertProcessIdentity();
    const predecessor = this.preparationTail;
    let releasePreparation!: () => void;
    this.preparationTail = new Promise<void>((resolvePreparation) => {
      releasePreparation = resolvePreparation;
    });
    await predecessor;
    try {
      const controlRootBefore = await assertControlRoot(this.boundary);
      const receiptRootBefore = await assertReceiptRoot(this.boundary);
      await Promise.all([
        assertReceiptNamespace(this.boundary),
        assertLegacyReceiptPathsAbsent(this.boundary),
      ]);
      const first = await readRootClaimMarkerSet(this.boundary);
      if (
        first?.event !== 'security_recovery_failed_terminal' ||
        first.claimId !== acknowledgment.claimId
      ) {
        throw new OwnerKemerbetReadinessCohortRejectedError();
      }
      await assertReceiptStageState(this.boundary, first);
      const alreadyAcknowledged = await installStagedControlFile(
        this.boundary,
        {
          installing: this.boundary.installingSecurityRecoveryProfileAcknowledgment,
          staged: this.boundary.securityRecoveryProfileAcknowledgment,
        },
        content,
        controlRootBefore,
      );
      const second = await readRootClaimMarkerSet(this.boundary);
      if (!second || !sameRootClaimMarker(first, second)) {
        throw new OwnerKemerbetReadinessCohortUnavailableError();
      }
      await assertReceiptStageState(this.boundary, second);
      await assertExactServiceFile(
        this.boundary,
        this.boundary.securityRecoveryProfileAcknowledgment,
        content,
      );
      await assertPathAbsent(this.boundary.installingSecurityRecoveryProfileAcknowledgment);
      await Promise.all([
        assertReceiptNamespace(this.boundary),
        assertLegacyReceiptPathsAbsent(this.boundary),
      ]);
      if (
        !sameControlRoot(controlRootBefore, await assertControlRoot(this.boundary)) ||
        !sameControlRoot(receiptRootBefore, await assertReceiptRoot(this.boundary))
      ) {
        throw new OwnerKemerbetReadinessCohortUnavailableError();
      }
      return {
        alreadyAcknowledged,
        identifiersRedacted: true,
        moneyMoved: false,
        transferDisabled: true,
      };
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

  private async inspectLifecycleBoundary(): Promise<{
    readonly lifecycle: OwnerKemerbetReadinessLifecycleState;
    readonly rootReceipt?: OwnerKemerbetReadinessRootReceipt;
  }> {
    this.assertProcessIdentity();
    try {
      const controlRootBefore = await assertControlRoot(this.boundary);
      const receiptRootBefore = await assertReceiptRoot(this.boundary);
      await Promise.all([
        assertReceiptNamespace(this.boundary),
        assertLegacyReceiptPathsAbsent(this.boundary),
      ]);
      const first = await readRootClaimMarkerSet(this.boundary);
      if (first) await assertReceiptStageState(this.boundary, first);
      const firstUnreceipted =
        !first || first.event === 'security_recovery_profile_finalized'
          ? await inspectUnreceiptedLifecycle(this.boundary)
          : undefined;
      await assertSecurityRecoveryAcknowledgmentState(this.boundary, first);
      await this.afterLifecycleInspectionForLinuxTest?.();
      const second = await readRootClaimMarkerSet(this.boundary);
      if (!sameRootClaimMarker(first, second)) {
        throw new OwnerKemerbetReadinessCohortUnavailableError();
      }
      if (second) await assertReceiptStageState(this.boundary, second);
      const secondUnreceipted =
        !second || second.event === 'security_recovery_profile_finalized'
          ? await inspectUnreceiptedLifecycle(this.boundary)
          : undefined;
      if (!sameUnreceiptedLifecycle(firstUnreceipted, secondUnreceipted)) {
        throw new OwnerKemerbetReadinessCohortUnavailableError();
      }
      await assertSecurityRecoveryAcknowledgmentState(this.boundary, second);
      await Promise.all([
        assertReceiptNamespace(this.boundary),
        assertLegacyReceiptPathsAbsent(this.boundary),
      ]);
      if (
        !sameControlRoot(controlRootBefore, await assertControlRoot(this.boundary)) ||
        !sameControlRoot(receiptRootBefore, await assertReceiptRoot(this.boundary))
      ) {
        throw new OwnerKemerbetReadinessCohortUnavailableError();
      }
      return second
        ? {
            lifecycle: second.event,
            rootReceipt: { claimId: second.claimId, event: second.event },
          }
        : { lifecycle: secondUnreceipted!.state };
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

  async lifecycle(): Promise<OwnerKemerbetReadinessLifecycleState> {
    return (await this.inspectLifecycleBoundary()).lifecycle;
  }

  async rootReceipt(): Promise<OwnerKemerbetReadinessRootReceipt | undefined> {
    return (await this.inspectLifecycleBoundary()).rootReceipt;
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
      const receiptRootBefore = await assertReceiptRoot(this.boundary);
      await Promise.all([
        assertReceiptNamespace(this.boundary),
        assertLegacyReceiptPathsAbsent(this.boundary),
      ]);
      const firstRecoveryMarker = await readRootClaimMarkerSet(this.boundary);
      if (
        firstRecoveryMarker &&
        (firstRecoveryMarker.event !== 'security_recovery_profile_finalized' ||
          firstRecoveryMarker.claimId === claimId)
      ) {
        throw new OwnerKemerbetReadinessCohortRejectedError();
      }
      await assertPrepareReceiptPaths(this.boundary, firstRecoveryMarker);
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
      await this.afterStagingForLinuxTest?.();
      const rootAfter = await assertControlRoot(this.boundary);
      if (!sameControlRoot(rootBefore, rootAfter)) {
        throw new OwnerKemerbetReadinessCohortUnavailableError();
      }
      await Promise.all([
        assertReceiptNamespace(this.boundary),
        assertLegacyReceiptPathsAbsent(this.boundary),
        assertPrepareReceiptPaths(this.boundary, firstRecoveryMarker),
      ]);
      if (!sameControlRoot(receiptRootBefore, await assertReceiptRoot(this.boundary))) {
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
  receiptRoot: string,
  afterStagingForLinuxTest?: () => Promise<void>,
  afterLifecycleInspectionForLinuxTest?: () => Promise<void>,
): FileOwnerKemerbetReadinessCohortControl {
  const effectiveUserId = process.geteuid?.();
  const effectiveGroupId = process.getegid?.();
  const temporaryRoot = resolve(tmpdir());
  const candidate = resolve(controlRoot);
  const receiptCandidate = resolve(receiptRoot);
  const relativeCandidate = relative(temporaryRoot, candidate);
  const relativeReceiptCandidate = relative(temporaryRoot, receiptCandidate);
  const controlToReceipt = relative(candidate, receiptCandidate);
  const receiptToControl = relative(receiptCandidate, candidate);
  const escapesParent = (value: string): boolean => value === '..' || value.startsWith('../');
  const isDescendant = (value: string): boolean =>
    value !== '' && !escapesParent(value) && !isAbsolute(value);
  const rootsOverlap =
    controlToReceipt === '' ||
    isDescendant(controlToReceipt) ||
    receiptToControl === '' ||
    isDescendant(receiptToControl);
  if (
    process.env.NODE_ENV !== 'test' ||
    process.platform !== 'linux' ||
    effectiveUserId === undefined ||
    effectiveGroupId === undefined ||
    !isAbsolute(controlRoot) ||
    !isAbsolute(receiptRoot) ||
    candidate !== controlRoot ||
    receiptCandidate !== receiptRoot ||
    rootsOverlap ||
    candidate === temporaryRoot ||
    receiptCandidate === temporaryRoot ||
    escapesParent(relativeCandidate) ||
    escapesParent(relativeReceiptCandidate) ||
    isAbsolute(relativeCandidate) ||
    isAbsolute(relativeReceiptCandidate)
  ) {
    throw new OwnerKemerbetReadinessCohortUnavailableError();
  }
  return new FileOwnerKemerbetReadinessCohortControl(
    LINUX_TEST_BOUNDARY_TOKEN,
    fileBoundary(
      candidate,
      receiptCandidate,
      effectiveUserId,
      effectiveGroupId,
      effectiveUserId,
      effectiveGroupId,
      effectiveUserId,
      effectiveGroupId,
      effectiveUserId,
      effectiveGroupId,
      0o555,
    ),
    afterStagingForLinuxTest,
    afterLifecycleInspectionForLinuxTest,
  );
}
