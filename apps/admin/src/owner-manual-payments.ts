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

export interface OwnerReceiverSmsInboxItem {
  readonly paymentEventId: string;
  readonly providerCode: 'telebirr' | 'cbe_birr';
  readonly paymentAt: string;
  readonly receivedAt: string;
  readonly amountMinor: string;
  readonly receiverAccountMasked: string;
  readonly receiverHolderName: string;
  readonly referenceMasked: string | null;
  readonly candidateId: string | null;
  readonly playerMasked: string | null;
  readonly status: string;
  readonly caseId: string | null;
  readonly canMarkManuallyCredited: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MASKED_REFERENCE = /^\*{3}[A-Z0-9]{4}$/u;
const MASKED_PLAYER = /^\*{3}[^\s\u0000-\u001f\u007f]{1,4}$/u;
const MASKED_RECEIVER = /^\*{3,4}[0-9]{4}$/u;
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
  if (
    typeof value !== 'string' ||
    !/^[1-9][0-9]*$/u.test(value) ||
    BigInt(value) > 2500000n ||
    BigInt(value) < 2500n
  )
    throw new OwnerManualPaymentUnavailableError();
  return value;
}

function provider(value: unknown): 'telebirr' | 'cbe_birr' {
  if (value !== 'telebirr' && value !== 'cbe_birr') throw new OwnerManualPaymentUnavailableError();
  return value;
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

/** Every query is an Owner-only, security-definer projection; no raw SMS or reference. */
export class PostgresOwnerManualPayments {
  constructor(private readonly database: OwnerManualPaymentDatabase) {}

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

  async listSms(
    actor: string,
    limit = 25,
    offset = 0,
  ): Promise<readonly OwnerReceiverSmsInboxItem[]> {
    if (
      !UUID.test(actor) ||
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
           from app.list_owner_receiver_sms_inbox($1::uuid,$2::integer,$3::integer)`,
        [actor, limit, offset],
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
        return {
          paymentEventId: uuid(row.payment_event_id)!,
          providerCode: provider(row.provider_code),
          paymentAt: date(row.payment_at)!,
          receivedAt: date(row.received_at)!,
          amountMinor: amount(row.amount_minor)!,
          receiverAccountMasked: masked(row.receiver_account_masked, MASKED_RECEIVER)!,
          receiverHolderName: row.receiver_holder_name,
          referenceMasked: masked(row.reference_masked, MASKED_REFERENCE, true),
          candidateId: uuid(row.candidate_id, true),
          playerMasked: masked(row.player_masked, MASKED_PLAYER, true),
          status: String(row.payment_status),
          caseId: uuid(row.case_id, true),
          canMarkManuallyCredited: row.can_mark_manually_credited,
        };
      });
    } catch (error) {
      translate(error);
    }
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
          BigInt(request.amountMinor) < 2500n ||
          BigInt(request.amountMinor) > 2500000n)) ||
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
