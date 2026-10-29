import {
  unprotectReceiverAccountReference,
  type DepositReferenceProtectionSecrets,
  type DepositProofReferenceProvider,
} from '@fetanagent/deposit-reference-protection';
import {
  openOwnerDepositProofReference,
  openReceiverSmsDisplayReference,
} from '@fetanagent/deposit-reference-protection/owner-payment-display';
import type { OwnerPaymentMethod } from './owner-payment-methods.js';

export class OwnerManualPaymentRejectedError extends Error {}
export class OwnerManualPaymentConflictError extends Error {}
export class OwnerManualPaymentUnavailableError extends Error {}

export interface OwnerManualPaymentDatabase {
  query(
    sql: string,
    values: readonly (string | number | boolean | null)[],
  ): Promise<{
    readonly rows: readonly unknown[];
  }>;
}

export interface OwnerManualCase {
  readonly caseId: string | null;
  readonly candidateId: string | null;
  readonly legacyCandidateId: string | null;
  readonly paymentEventId: string | null;
  readonly providerCode: 'telebirr' | 'cbe_birr';
  readonly referenceMasked: string | null;
  readonly submittedAt: string | null;
  readonly paymentAt: string | null;
  readonly amountMinor: string | null;
  readonly receiverAccountId: string | null;
  readonly receiverAccountMasked: string | null;
  readonly playerMasked: string | null;
  readonly status: 'pending' | 'awaiting_manual_credit' | 'manually_credited' | 'rejected';
  readonly rejectionReason: string | null;
  readonly decidedAt: string | null;
  readonly completedAt: string | null;
}

export interface OwnerSubmittedPayment {
  readonly caseId: string | null;
  readonly candidateId: string | null;
  readonly legacyCandidateId: string | null;
  readonly paymentEventId: string | null;
  readonly providerCode: 'telebirr' | 'cbe_birr';
  readonly referenceMasked: string | null;
  readonly reference?: string | null;
  readonly submittedAt: string;
  readonly paymentAt: string | null;
  readonly amountMinor: string | null;
  readonly receiverAccountId: string | null;
  readonly receiverAccountMasked: string | null;
  readonly receiverAccount?: string | null;
  readonly playerId: string;
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly statusDetail: string;
  readonly ownerCaseStatus: 'awaiting_manual_credit' | 'manually_credited' | 'rejected' | null;
  readonly rejectionReason: string | null;
  readonly decidedAt: string | null;
  readonly completedAt: string | null;
  readonly canApprove: boolean;
  readonly canReject: boolean;
  readonly canRecordStoppedCredit: boolean;
}

export interface OwnerReceiverSmsInboxItem {
  readonly paymentEventId: string;
  readonly providerCode: 'telebirr' | 'cbe_birr';
  readonly paymentAt: string;
  readonly receivedAt: string;
  readonly amountMinor: string;
  readonly receiverAccountMasked: string;
  readonly receiverAccount?: string;
  readonly receiverHolderName: string;
  readonly referenceMasked: string | null;
  readonly reference?: string | null;
  readonly candidateId: string | null;
  readonly playerMasked: string | null;
  readonly playerId?: string | null;
  readonly status: string;
  readonly caseId: string | null;
  readonly canMarkManuallyCredited: boolean;
}

export interface OwnerSystemOverview {
  readonly paymentVerificationMode: 'disabled' | 'dry_run' | 'live' | null;
  readonly depositExecutionMode: 'disabled' | 'dry_run' | 'live' | null;
  readonly telebirrReceiptLookupMode: 'disabled' | 'dry_run' | 'live' | null;
  readonly paymentMethods: readonly {
    readonly providerCode: 'telebirr' | 'cbe_birr';
    readonly ownerEnabled: boolean;
    readonly readiness: OwnerPaymentMethod['readiness'];
  }[];
  readonly telebirrSmsLastReceivedAt: string | null;
  readonly cbeSmsLastReceivedAt: string | null;
  readonly routineCompanionLastSeenAt: string | null;
  readonly openDepositJobs: number;
  readonly readyDepositJobs: number;
  readonly oldestReadyDepositJobAt: string | null;
  readonly leasedDepositJobs: number;
  readonly overdueLeasedDepositJobs: number;
  readonly deadDepositJobs: number;
  readonly awaitingManualCredits: number;
  readonly pendingPlayerValidations: number;
  readonly oldestPendingPlayerValidationAt: string | null;
  readonly checkedAt: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MASKED_REFERENCE = /^\*{3}[A-Z0-9]{4}$/u;
const MASKED_PLAYER = /^\*{3}[^\s\u0000-\u001f\u007f]{1,4}$/u;
const MASKED_RECEIVER = /^\*{3,4}[0-9]{4}$/u;
const PLAYER_ID = /^[^\s\u0000-\u001f\u007f]{1,64}$/u;
const STATUSES = new Set(['pending', 'awaiting_manual_credit', 'manually_credited', 'rejected']);
const SMS_STATUSES = new Set([
  'unmatched',
  'submission_waiting',
  'pending_review',
  'auto_processing',
  'auto_credited',
  'auto_not_credited',
  'auto_used',
  'awaiting_manual_credit',
  'manually_credited',
  'rejected',
]);

function isoDate(value: string | undefined): boolean {
  if (value === undefined) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new OwnerManualPaymentUnavailableError();
  return value as Record<string, unknown>;
}

function uuid(value: unknown, optional = false): string | null {
  if (optional && value === null) return null;
  if (typeof value !== 'string' || !UUID.test(value))
    throw new OwnerManualPaymentUnavailableError();
  return value;
}

function date(value: unknown, optional = false): string | null {
  if (optional && value === null) return null;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    throw new OwnerManualPaymentUnavailableError();
  return value.toISOString();
}

function masked(value: unknown, pattern: RegExp, optional = false): string | null {
  if (optional && value === null) return null;
  if (typeof value !== 'string' || !pattern.test(value))
    throw new OwnerManualPaymentUnavailableError();
  return value;
}

function amount(value: unknown, optional = false): string | null {
  if (optional && value === null) return null;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/u.test(value) || BigInt(value) > 9999999999n)
    throw new OwnerManualPaymentUnavailableError();
  return value;
}

function displayedPaymentAmount(value: unknown, optional = false): string | null {
  if (optional && value === null) return null;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/u.test(value) || BigInt(value) > 9999999999n)
    throw new OwnerManualPaymentUnavailableError();
  return value;
}

function provider(value: unknown): 'telebirr' | 'cbe_birr' {
  if (value !== 'telebirr' && value !== 'cbe_birr') throw new OwnerManualPaymentUnavailableError();
  return value;
}

function mode(value: unknown): OwnerSystemOverview['paymentVerificationMode'] {
  if (value === null || value === 'disabled' || value === 'dry_run' || value === 'live')
    return value;
  throw new OwnerManualPaymentUnavailableError();
}

function overviewTime(value: unknown, optional = false): string | null {
  if (optional && value === null) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw new OwnerManualPaymentUnavailableError();
  return value;
}

function overviewCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new OwnerManualPaymentUnavailableError();
  return value as number;
}

const OVERVIEW_METHOD_READINESS = new Set([
  'ready',
  'provider_unavailable',
  'receiver_missing',
  'receiver_not_protected',
  'payments_paused',
  'sms_route_paused',
  'verification_paused',
  'credit_worker_offline',
  'credit_worker_paused',
  'phone_not_paired',
  'new_receiver_sms_not_seen',
]);

function overviewPaymentMethods(value: unknown): OwnerSystemOverview['paymentMethods'] {
  if (!Array.isArray(value) || value.length !== 2) throw new OwnerManualPaymentUnavailableError();
  const methods = value.map((candidate) => {
    const method = object(candidate);
    if (
      Object.keys(method).sort().join(',') !== 'ownerEnabled,providerCode,readiness' ||
      (method.providerCode !== 'telebirr' && method.providerCode !== 'cbe_birr') ||
      typeof method.ownerEnabled !== 'boolean' ||
      typeof method.readiness !== 'string' ||
      !OVERVIEW_METHOD_READINESS.has(method.readiness)
    )
      throw new OwnerManualPaymentUnavailableError();
    return {
      providerCode: method.providerCode as 'telebirr' | 'cbe_birr',
      ownerEnabled: method.ownerEnabled,
      readiness: method.readiness as OwnerPaymentMethod['readiness'],
    };
  });
  if (methods[0]?.providerCode !== 'cbe_birr' || methods[1]?.providerCode !== 'telebirr')
    throw new OwnerManualPaymentUnavailableError();
  return methods;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

function translate(error: unknown): never {
  if (error instanceof OwnerManualPaymentUnavailableError) throw error;
  if (errorCode(error) === '42501') throw new OwnerManualPaymentRejectedError();
  if (errorCode(error) === 'P0001' || errorCode(error) === '23505')
    throw new OwnerManualPaymentConflictError();
  throw new OwnerManualPaymentUnavailableError();
}

export interface OwnerPaymentDisplaySecrets {
  readonly receiverSecrets: DepositReferenceProtectionSecrets;
  readonly proofSecrets: DepositReferenceProtectionSecrets;
  readonly smsDisplayEncryptionSecret: string;
}

/** Every query is an Owner-only, security-definer projection; ciphertext opens only here. */
export class PostgresOwnerManualPayments {
  constructor(
    private readonly database: OwnerManualPaymentDatabase,
    private readonly displaySecrets?: OwnerPaymentDisplaySecrets,
  ) {}

  async systemOverview(actor: string): Promise<OwnerSystemOverview> {
    if (!UUID.test(actor)) throw new OwnerManualPaymentRejectedError();
    try {
      const result = await this.database.query(
        'select app.get_owner_system_overview($1::uuid) as overview',
        [actor],
      );
      if (result.rows.length !== 1) throw new OwnerManualPaymentUnavailableError();
      const value = object(object(result.rows[0]).overview);
      const overview: OwnerSystemOverview = {
        paymentVerificationMode: mode(value.paymentVerificationMode),
        depositExecutionMode: mode(value.depositExecutionMode),
        telebirrReceiptLookupMode: mode(value.telebirrReceiptLookupMode),
        paymentMethods: overviewPaymentMethods(value.paymentMethods),
        telebirrSmsLastReceivedAt: overviewTime(value.telebirrSmsLastReceivedAt, true),
        cbeSmsLastReceivedAt: overviewTime(value.cbeSmsLastReceivedAt, true),
        routineCompanionLastSeenAt: overviewTime(value.routineCompanionLastSeenAt, true),
        openDepositJobs: overviewCount(value.openDepositJobs),
        readyDepositJobs: overviewCount(value.readyDepositJobs),
        oldestReadyDepositJobAt: overviewTime(value.oldestReadyDepositJobAt, true),
        leasedDepositJobs: overviewCount(value.leasedDepositJobs),
        overdueLeasedDepositJobs: overviewCount(value.overdueLeasedDepositJobs),
        deadDepositJobs: overviewCount(value.deadDepositJobs),
        awaitingManualCredits: overviewCount(value.awaitingManualCredits),
        pendingPlayerValidations: overviewCount(value.pendingPlayerValidations),
        oldestPendingPlayerValidationAt: overviewTime(value.oldestPendingPlayerValidationAt, true),
        checkedAt: overviewTime(value.checkedAt)!,
      };
      if (
        overview.readyDepositJobs + overview.leasedDepositJobs > overview.openDepositJobs ||
        overview.overdueLeasedDepositJobs > overview.leasedDepositJobs ||
        overview.readyDepositJobs > 0 !== (overview.oldestReadyDepositJobAt !== null) ||
        overview.pendingPlayerValidations > 0 !==
          (overview.oldestPendingPlayerValidationAt !== null) ||
        (overview.oldestReadyDepositJobAt !== null &&
          Date.parse(overview.oldestReadyDepositJobAt) > Date.parse(overview.checkedAt)) ||
        (overview.oldestPendingPlayerValidationAt !== null &&
          Date.parse(overview.oldestPendingPlayerValidationAt) > Date.parse(overview.checkedAt)) ||
        (overview.routineCompanionLastSeenAt !== null &&
          Date.parse(overview.routineCompanionLastSeenAt) > Date.parse(overview.checkedAt))
      )
        throw new OwnerManualPaymentUnavailableError();
      return overview;
    } catch (error) {
      translate(error);
    }
  }

  async listCases(
    actor: string,
    status: OwnerManualCase['status'],
    limit = 25,
    offset = 0,
  ): Promise<readonly OwnerManualCase[]> {
    if (
      !UUID.test(actor) ||
      !STATUSES.has(status) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > 10000
    )
      throw new OwnerManualPaymentRejectedError();
    try {
      const result = await this.database.query(
        `select case_id, candidate_id, legacy_candidate_id, payment_event_id, provider_code,
                reference_masked, submitted_at, payment_at,
                amount_minor::text as amount_minor, receiver_account_id,
                receiver_account_masked, player_masked, case_status,
                rejection_reason, decided_at, completed_at
           from app.list_owner_manual_payment_cases($1::uuid,$2::text,$3::integer,$4::integer)`,
        [actor, status, limit, offset],
      );
      if (result.rows.length > limit) throw new OwnerManualPaymentUnavailableError();
      return result.rows.map((raw) => {
        const row = object(raw);
        if (
          row.case_status !== status ||
          (status === 'pending') !== (row.case_id === null) ||
          (status === 'pending' && row.candidate_id === null && row.legacy_candidate_id === null) ||
          (status === 'rejected' &&
            (typeof row.rejection_reason !== 'string' || row.rejection_reason.length < 10)) ||
          (status !== 'rejected' && status !== 'manually_credited' && row.rejection_reason !== null)
        )
          throw new OwnerManualPaymentUnavailableError();
        return {
          caseId: uuid(row.case_id, true),
          candidateId: uuid(row.candidate_id, true),
          legacyCandidateId: uuid(row.legacy_candidate_id, true),
          paymentEventId: uuid(row.payment_event_id, true),
          providerCode: provider(row.provider_code),
          referenceMasked: masked(row.reference_masked, MASKED_REFERENCE, true),
          submittedAt: date(row.submitted_at, true),
          paymentAt: date(row.payment_at, true),
          amountMinor: amount(row.amount_minor, true),
          receiverAccountId: uuid(row.receiver_account_id, true),
          receiverAccountMasked: masked(row.receiver_account_masked, MASKED_RECEIVER, true),
          playerMasked: masked(row.player_masked, MASKED_PLAYER, true),
          status,
          rejectionReason: row.rejection_reason as string | null,
          decidedAt: date(row.decided_at, true),
          completedAt: date(row.completed_at, true),
        };
      });
    } catch (error) {
      translate(error);
    }
  }

  async listSubmittedPayments(
    actor: string,
    status: OwnerSubmittedPayment['status'],
    limit = 25,
    offset = 0,
  ): Promise<readonly OwnerSubmittedPayment[]> {
    if (
      !UUID.test(actor) ||
      !['pending', 'approved', 'rejected'].includes(status) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > 10000
    )
      throw new OwnerManualPaymentRejectedError();
    try {
      const result = await this.database.query(
        `select case_id, candidate_id, legacy_candidate_id, payment_event_id,
                provider_code, reference_masked, submitted_at, payment_at,
                amount_minor::text as amount_minor, receiver_account_id,
                receiver_account_masked, player_id, payment_status, status_detail,
                owner_case_status, rejection_reason, decided_at, completed_at,
                can_approve, can_reject,
                app.owner_can_record_stopped_credit($1::uuid,candidate_id)
                  as can_record_stopped_credit${
                    this.displaySecrets
                      ? ', reference_ciphertext, reference_fingerprint, receiver_ciphertext, receiver_fingerprint'
                      : ''
                  }
           from app.${
             this.displaySecrets
               ? 'list_owner_submitted_payments_sensitive'
               : 'list_owner_submitted_payments'
           }($1::uuid,$2::text,$3::integer,$4::integer)`,
        [actor, status, limit, offset],
      );
      if (result.rows.length > limit) throw new OwnerManualPaymentUnavailableError();
      return result.rows.map((raw) => {
        const row = object(raw);
        if (
          row.payment_status !== status ||
          typeof row.player_id !== 'string' ||
          !PLAYER_ID.test(row.player_id) ||
          typeof row.status_detail !== 'string' ||
          row.status_detail.length > 160 ||
          (row.owner_case_status !== null &&
            !['awaiting_manual_credit', 'manually_credited', 'rejected'].includes(
              String(row.owner_case_status),
            )) ||
          typeof row.can_approve !== 'boolean' ||
          typeof row.can_reject !== 'boolean' ||
          typeof row.can_record_stopped_credit !== 'boolean' ||
          (row.can_approve && (status !== 'pending' || !row.can_reject)) ||
          (row.can_record_stopped_credit &&
            (status !== 'pending' ||
              row.candidate_id === null ||
              row.payment_event_id === null ||
              row.can_approve ||
              row.can_reject)) ||
          (row.rejection_reason !== null && typeof row.rejection_reason !== 'string')
        )
          throw new OwnerManualPaymentUnavailableError();
        return {
          caseId: uuid(row.case_id, true),
          candidateId: uuid(row.candidate_id, true),
          legacyCandidateId: uuid(row.legacy_candidate_id, true),
          paymentEventId: uuid(row.payment_event_id, true),
          providerCode: provider(row.provider_code),
          referenceMasked: masked(row.reference_masked, MASKED_REFERENCE, true),
          ...(this.displaySecrets
            ? {
                reference:
                  row.reference_masked === null
                    ? null
                    : openOwnerDepositProofReference({
                        provider: provider(row.provider_code),
                        ciphertext: String(row.reference_ciphertext),
                        fingerprint: String(row.reference_fingerprint),
                        masked: String(row.reference_masked),
                        secrets: this.displaySecrets.proofSecrets,
                      }),
              }
            : {}),
          submittedAt: date(row.submitted_at)!,
          paymentAt: date(row.payment_at, true),
          amountMinor: displayedPaymentAmount(row.amount_minor, true),
          receiverAccountId: uuid(row.receiver_account_id, true),
          receiverAccountMasked: masked(row.receiver_account_masked, MASKED_RECEIVER, true),
          ...(this.displaySecrets
            ? {
                receiverAccount:
                  row.receiver_account_masked === null
                    ? null
                    : unprotectReceiverAccountReference({
                        provider: provider(row.provider_code),
                        ciphertext: String(row.receiver_ciphertext),
                        fingerprint: String(row.receiver_fingerprint),
                        masked: String(row.receiver_account_masked),
                        secrets: this.displaySecrets.receiverSecrets,
                      }),
              }
            : {}),
          playerId: row.player_id,
          status,
          statusDetail: row.status_detail,
          ownerCaseStatus: row.owner_case_status as OwnerSubmittedPayment['ownerCaseStatus'],
          rejectionReason: row.rejection_reason as string | null,
          decidedAt: date(row.decided_at, true),
          completedAt: date(row.completed_at, true),
          canApprove: row.can_approve,
          canReject: row.can_reject,
          canRecordStoppedCredit: row.can_record_stopped_credit,
        };
      });
    } catch (error) {
      translate(error);
    }
  }

  async approveForImmediateCredit(
    actor: string,
    candidateId: string,
    request: {
      readonly amountMinor: string | null;
      readonly receiverAccountId: string | null;
      readonly bankPaymentConfirmed: boolean;
    },
  ): Promise<{ readonly caseId: string; readonly status: 'manually_credited' }> {
    if (
      !UUID.test(actor) ||
      !UUID.test(candidateId) ||
      (request.amountMinor !== null &&
        (!/^[1-9][0-9]*$/u.test(request.amountMinor) ||
          BigInt(request.amountMinor) > 9999999999n)) ||
      (request.receiverAccountId !== null && !UUID.test(request.receiverAccountId)) ||
      typeof request.bankPaymentConfirmed !== 'boolean'
    )
      throw new OwnerManualPaymentRejectedError();
    try {
      const result = await this.database.query(
        `select app.approve_owner_manual_payment_for_immediate_credit(
          $1::uuid,$2::uuid,$3::bigint,$4::uuid,$5::boolean
        ) as approved`,
        [
          actor,
          candidateId,
          request.amountMinor,
          request.receiverAccountId,
          request.bankPaymentConfirmed,
        ],
      );
      if (result.rows.length !== 1) throw new OwnerManualPaymentUnavailableError();
      const row = object(object(result.rows[0]).approved);
      if (row.status !== 'manually_credited') throw new OwnerManualPaymentUnavailableError();
      return { caseId: uuid(row.caseId)!, status: 'manually_credited' };
    } catch (error) {
      translate(error);
    }
  }

  async recordStoppedCredit(
    actor: string,
    candidateId: string,
  ): Promise<{ readonly caseId: string; readonly status: 'manually_credited' }> {
    if (!UUID.test(actor) || !UUID.test(candidateId)) throw new OwnerManualPaymentRejectedError();
    try {
      const result = await this.database.query(
        `select app.record_owner_stopped_credit($1::uuid,$2::uuid,$3::boolean) as completed`,
        [actor, candidateId, true],
      );
      if (result.rows.length !== 1) throw new OwnerManualPaymentUnavailableError();
      const row = object(object(result.rows[0]).completed);
      if (row.status !== 'manually_credited') throw new OwnerManualPaymentUnavailableError();
      return { caseId: uuid(row.caseId)!, status: 'manually_credited' };
    } catch (error) {
      translate(error);
    }
  }

  async listSms(
    actor: string,
    limit = 50,
    offset = 0,
    providerFilter = 'all',
    statusFilter = 'all',
    referenceLast4?: string,
    receivedFrom?: string,
    receivedTo?: string,
  ): Promise<readonly OwnerReceiverSmsInboxItem[]> {
    if (
      !UUID.test(actor) ||
      !['all', 'telebirr', 'cbe_birr'].includes(providerFilter) ||
      (statusFilter !== 'all' && !SMS_STATUSES.has(statusFilter)) ||
      (referenceLast4 !== undefined && !/^[A-Z0-9]{4}$/u.test(referenceLast4)) ||
      !isoDate(receivedFrom) ||
      !isoDate(receivedTo) ||
      (receivedFrom !== undefined && receivedTo !== undefined && receivedFrom > receivedTo) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > 10000
    )
      throw new OwnerManualPaymentRejectedError();
    try {
      const result = await this.database.query(
        `select payment_event_id, provider_code, payment_at, received_at,
                amount_minor::text as amount_minor, receiver_account_masked,
                receiver_holder_name, reference_masked, candidate_id,
                player_masked, payment_status, case_id, can_mark_manually_credited
                ${
                  this.displaySecrets
                    ? ', receiver_ciphertext, receiver_fingerprint, player_id, reference_ciphertext, reference_source, reference_digest, reference_fingerprint, display_reference_masked'
                    : ''
                }
           from app.${
             this.displaySecrets
               ? 'list_owner_receiver_sms_inbox_sensitive'
               : 'list_owner_receiver_sms_inbox_filtered'
           }(
             $1::uuid,$2::text,$3::text,$4::text,$5::date,$6::date,$7::integer,$8::integer)`,
        [
          actor,
          providerFilter,
          statusFilter,
          referenceLast4 ?? null,
          receivedFrom ?? null,
          receivedTo ?? null,
          limit,
          offset,
        ],
      );
      if (result.rows.length > limit) throw new OwnerManualPaymentUnavailableError();
      return result.rows.map((raw) => {
        const row = object(raw);
        if (
          !SMS_STATUSES.has(String(row.payment_status)) ||
          typeof row.receiver_holder_name !== 'string' ||
          row.receiver_holder_name.length < 1 ||
          row.receiver_holder_name.length > 160 ||
          typeof row.can_mark_manually_credited !== 'boolean'
        )
          throw new OwnerManualPaymentUnavailableError();
        const amountMinor = displayedPaymentAmount(row.amount_minor)!;
        return {
          paymentEventId: uuid(row.payment_event_id)!,
          providerCode: provider(row.provider_code),
          paymentAt: date(row.payment_at)!,
          receivedAt: date(row.received_at)!,
          amountMinor,
          receiverAccountMasked: masked(row.receiver_account_masked, MASKED_RECEIVER)!,
          ...(this.displaySecrets
            ? {
                receiverAccount: unprotectReceiverAccountReference({
                  provider: provider(row.provider_code),
                  ciphertext: String(row.receiver_ciphertext),
                  fingerprint: String(row.receiver_fingerprint),
                  masked: String(row.receiver_account_masked),
                  secrets: this.displaySecrets.receiverSecrets,
                }),
              }
            : {}),
          receiverHolderName: row.receiver_holder_name,
          referenceMasked: masked(row.reference_masked, MASKED_REFERENCE, true),
          ...(this.displaySecrets
            ? {
                reference: this.smsReference(row, provider(row.provider_code)),
              }
            : {}),
          candidateId: uuid(row.candidate_id, true),
          playerMasked: masked(row.player_masked, MASKED_PLAYER, true),
          ...(this.displaySecrets
            ? {
                playerId:
                  row.player_id === null
                    ? null
                    : typeof row.player_id === 'string' && PLAYER_ID.test(row.player_id)
                      ? row.player_id
                      : (() => {
                          throw new OwnerManualPaymentUnavailableError();
                        })(),
              }
            : {}),
          status: String(row.payment_status),
          caseId: uuid(row.case_id, true),
          canMarkManuallyCredited: row.can_mark_manually_credited,
        };
      });
    } catch (error) {
      translate(error);
    }
  }

  private smsReference(
    row: Record<string, unknown>,
    code: DepositProofReferenceProvider,
  ): string | null {
    if (!this.displaySecrets) throw new OwnerManualPaymentUnavailableError();
    if (row.reference_source === 'unavailable') {
      if (row.reference_ciphertext !== null) throw new OwnerManualPaymentUnavailableError();
      return null;
    }
    if (row.reference_source === 'candidate') {
      return openOwnerDepositProofReference({
        provider: code,
        ciphertext: String(row.reference_ciphertext),
        fingerprint: String(row.reference_fingerprint),
        masked: String(row.display_reference_masked),
        secrets: this.displaySecrets.proofSecrets,
      });
    }
    if (row.reference_source === 'sms_display') {
      return openReceiverSmsDisplayReference({
        provider: code,
        ciphertext: String(row.reference_ciphertext),
        masked: String(row.display_reference_masked),
        referenceDigest: String(row.reference_digest),
        encryptionSecret: this.displaySecrets.smsDisplayEncryptionSecret,
      });
    }
    throw new OwnerManualPaymentUnavailableError();
  }

  async decide(
    actor: string,
    candidateId: string,
    decision: 'approve' | 'reject',
    reason: string | null,
  ): Promise<{ readonly caseId: string; readonly status: 'awaiting_manual_credit' | 'rejected' }> {
    if (
      !UUID.test(actor) ||
      !UUID.test(candidateId) ||
      (decision !== 'approve' && decision !== 'reject') ||
      (decision === 'approve' && reason !== null) ||
      (decision === 'reject' &&
        (typeof reason !== 'string' ||
          reason.trim() !== reason ||
          reason.length < 10 ||
          reason.length > 240 ||
          /[\u0000-\u001f\u007f]/u.test(reason)))
    )
      throw new OwnerManualPaymentRejectedError();
    try {
      const result = await this.database.query(
        'select app.decide_owner_manual_payment_case($1::uuid,$2::uuid,$3::text,$4::text) as decision',
        [actor, candidateId, decision, reason],
      );
      if (result.rows.length !== 1) throw new OwnerManualPaymentUnavailableError();
      const row = object(object(result.rows[0]).decision);
      if (row.status !== (decision === 'approve' ? 'awaiting_manual_credit' : 'rejected'))
        throw new OwnerManualPaymentUnavailableError();
      return {
        caseId: uuid(row.caseId)!,
        status: row.status as 'awaiting_manual_credit' | 'rejected',
      };
    } catch (error) {
      translate(error);
    }
  }

  async complete(
    actor: string,
    request: {
      readonly caseId: string | null;
      readonly paymentEventId: string | null;
      readonly amountMinor: string | null;
      readonly receiverAccountId: string | null;
      readonly bankPaymentConfirmed: boolean;
      readonly playerCreditedConfirmed: true;
    },
  ): Promise<{ readonly caseId: string; readonly status: 'manually_credited' }> {
    if (
      !UUID.test(actor) ||
      (request.caseId === null) === (request.paymentEventId === null) ||
      (request.caseId !== null && !UUID.test(request.caseId)) ||
      (request.paymentEventId !== null && !UUID.test(request.paymentEventId)) ||
      (request.amountMinor !== null &&
        (!/^[1-9][0-9]*$/u.test(request.amountMinor) ||
          BigInt(request.amountMinor) > 9999999999n)) ||
      (request.receiverAccountId !== null && !UUID.test(request.receiverAccountId)) ||
      typeof request.bankPaymentConfirmed !== 'boolean' ||
      request.playerCreditedConfirmed !== true
    )
      throw new OwnerManualPaymentRejectedError();
    try {
      const result = await this.database.query(
        `select app.complete_owner_manual_payment_case(
          $1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::uuid,$6::boolean,$7::boolean
        ) as completed`,
        [
          actor,
          request.caseId,
          request.paymentEventId,
          request.amountMinor,
          request.receiverAccountId,
          request.bankPaymentConfirmed,
          request.playerCreditedConfirmed,
        ],
      );
      if (result.rows.length !== 1) throw new OwnerManualPaymentUnavailableError();
      const row = object(object(result.rows[0]).completed);
      if (row.status !== 'manually_credited') throw new OwnerManualPaymentUnavailableError();
      return { caseId: uuid(row.caseId)!, status: 'manually_credited' };
    } catch (error) {
      translate(error);
    }
  }
}
