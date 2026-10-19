import { types as nodeUtilTypes } from 'node:util';

import {
  retrieveAndAssessCbeBirrProtectedReceiptNoMoney,
  type CbeBirrNoMoneyAssessment,
} from '@fetanagent/cbe-birr-authoritative-receipt-transport/no-money';
import type { CbeBirrAuthoritativeReceiptTransportControl } from '@fetanagent/cbe-birr-authoritative-receipt-transport';
import { withOpenedCbeBirrDepositProofReference } from '@fetanagent/cbe-birr-reference-opening';
import type {
  CbeBirrReceiverLookupKeyCustodyConfig,
  CbeBirrWorkerKeyCustodyConfig,
} from '@fetanagent/cbe-birr-worker-key-custody';

export const READ_CBE_BIRR_NO_MONEY_CANDIDATE_SQL =
  'select * from app.read_cbe_birr_no_money_candidate($1::uuid)';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROOF_ENVELOPE =
  /^v2\.cbe_birr\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{11,43}$/u;
const RECEIVER_ENVELOPE =
  /^cbe-receiver-v2\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{16}$/u;
const PROOF_MASK = /^\*{3}[A-Z0-9]{4}$/u;
const RECEIVER_MASK = /^\*{3}[0-9]{4}$/u;
const PRINCIPAL = /^(0|[1-9][0-9]{0,17})$/u;
const REASONS = new Set([
  'receipt_unavailable',
  'receipt_requires_review',
  'receiver_revision_inactive',
  'principal_out_of_range',
  'instruction_window_review',
  'receipt_consistent_advisory',
]);
const COLUMNS = [
  'candidate_id',
  'proof_request_id',
  'reference_ciphertext',
  'reference_masked',
  'reference_profile_version',
  'reference_encryption_key_version',
  'receiver_revision_id',
  'receiver_version',
  'receiver_rotation_request_id',
  'receiver_lookup_ciphertext',
  'receiver_lookup_masked',
  'receiver_lookup_profile_version',
  'receiver_lookup_encryption_key_version',
  'instruction_issued_at',
  'instruction_expires_at',
  'proof_submitted_at',
  'receiver_active_at_submission',
] as const;

export interface CbeBirrNoMoneyCandidateDatabase {
  query(sql: string, values: readonly unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
}

export type CbeBirrNoMoneyCandidateResult = Readonly<{
  candidateId: string;
  providerCode: 'cbe_birr';
  advisoryOnly: true;
  sourceContractAttested: false;
  claimAllowed: false;
  financialActionAllowed: false;
  disposition: 'would_review' | 'receipt_consistent_advisory';
  reasonCode: CbeBirrNoMoneyAssessment['reasonCode'];
  principalAmountMinor?: string;
}>;

export class CbeBirrNoMoneyCandidateUnavailableError extends Error {
  constructor() {
    super('The CBE Birr no-money candidate is unavailable.');
    this.name = 'CbeBirrNoMoneyCandidateUnavailableError';
  }
}

type Assessor = typeof retrieveAndAssessCbeBirrProtectedReceiptNoMoney;

function exactRow(value: unknown, candidateId: string): Record<(typeof COLUMNS)[number], unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    nodeUtilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== COLUMNS.length ||
    COLUMNS.some((column) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, column);
      return descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value');
    })
  ) {
    throw new CbeBirrNoMoneyCandidateUnavailableError();
  }
  const row = value as Record<(typeof COLUMNS)[number], unknown>;
  const issued = row.instruction_issued_at;
  const expires = row.instruction_expires_at;
  const submitted = row.proof_submitted_at;
  if (
    row.candidate_id !== candidateId ||
    typeof row.proof_request_id !== 'string' ||
    !UUID.test(row.proof_request_id) ||
    typeof row.reference_ciphertext !== 'string' ||
    !PROOF_ENVELOPE.test(row.reference_ciphertext) ||
    typeof row.reference_masked !== 'string' ||
    !PROOF_MASK.test(row.reference_masked) ||
    row.reference_profile_version !== 2 ||
    row.reference_encryption_key_version !== 2 ||
    typeof row.receiver_revision_id !== 'string' ||
    !UUID.test(row.receiver_revision_id) ||
    !Number.isSafeInteger(row.receiver_version) ||
    typeof row.receiver_version !== 'number' ||
    row.receiver_version < 1 ||
    typeof row.receiver_rotation_request_id !== 'string' ||
    !UUID.test(row.receiver_rotation_request_id) ||
    typeof row.receiver_lookup_ciphertext !== 'string' ||
    !RECEIVER_ENVELOPE.test(row.receiver_lookup_ciphertext) ||
    typeof row.receiver_lookup_masked !== 'string' ||
    !RECEIVER_MASK.test(row.receiver_lookup_masked) ||
    row.receiver_lookup_profile_version !== 2 ||
    row.receiver_lookup_encryption_key_version !== 2 ||
    !(issued instanceof Date) ||
    !(expires instanceof Date) ||
    !(submitted instanceof Date) ||
    !Number.isFinite(issued.getTime()) ||
    !Number.isFinite(expires.getTime()) ||
    !Number.isFinite(submitted.getTime()) ||
    expires.getTime() - issued.getTime() !== 3_600_000 ||
    submitted.getTime() < issued.getTime() ||
    submitted.getTime() >= expires.getTime() ||
    row.receiver_active_at_submission !== true
  ) {
    throw new CbeBirrNoMoneyCandidateUnavailableError();
  }
  return row;
}

function safeResult(
  candidateId: string,
  assessment: CbeBirrNoMoneyAssessment,
): CbeBirrNoMoneyCandidateResult {
  if (
    assessment.contractVersion !== 1 ||
    assessment.providerCode !== 'cbe_birr' ||
    assessment.advisoryOnly !== true ||
    assessment.sourceContractAttested !== false ||
    assessment.runtimeWiringAllowed !== false ||
    assessment.claimAllowed !== false ||
    assessment.financialActionAllowed !== false ||
    !REASONS.has(assessment.reasonCode) ||
    (assessment.disposition === 'receipt_consistent_advisory') !==
      (assessment.reasonCode === 'receipt_consistent_advisory') ||
    (assessment.disposition !== 'would_review' &&
      assessment.disposition !== 'receipt_consistent_advisory') ||
    (assessment.disposition === 'receipt_consistent_advisory' &&
      (typeof assessment.principalAmountMinor !== 'string' ||
        !PRINCIPAL.test(assessment.principalAmountMinor))) ||
    (assessment.disposition === 'would_review' && assessment.principalAmountMinor !== undefined)
  ) {
    throw new CbeBirrNoMoneyCandidateUnavailableError();
  }
  return Object.freeze({
    candidateId,
    providerCode: 'cbe_birr',
    advisoryOnly: true,
    sourceContractAttested: false,
    claimAllowed: false,
    financialActionAllowed: false,
    disposition: assessment.disposition,
    reasonCode: assessment.reasonCode,
    ...(assessment.principalAmountMinor === undefined
      ? {}
      : { principalAmountMinor: assessment.principalAmountMinor }),
  });
}

/** Explicit, single-candidate no-money adapter. Nothing invokes it from the worker entrypoint. */
export async function assessCbeBirrCandidateNoMoney(
  database: CbeBirrNoMoneyCandidateDatabase,
  candidateId: string,
  referenceCustody: CbeBirrWorkerKeyCustodyConfig,
  receiverCustody: CbeBirrReceiverLookupKeyCustodyConfig,
  control: CbeBirrAuthoritativeReceiptTransportControl,
  assessor: Assessor = retrieveAndAssessCbeBirrProtectedReceiptNoMoney,
): Promise<CbeBirrNoMoneyCandidateResult> {
  try {
    if (
      !UUID.test(candidateId) ||
      !referenceCustody.enabled ||
      referenceCustody.deploymentTarget !== 'production' ||
      !receiverCustody.enabled ||
      receiverCustody.deploymentTarget !== 'production' ||
      control.contractVersion !== 1 ||
      control.providerCode !== 'cbe_birr' ||
      control.providerRequest !== 'allow_one' ||
      control.incidentStop !== 'closed'
    ) {
      throw new Error();
    }
    const rows = (await database.query(READ_CBE_BIRR_NO_MONEY_CANDIDATE_SQL, [candidateId])).rows;
    if (rows.length !== 1) throw new Error();
    const row = exactRow(rows[0], candidateId);
    if (
      row.receiver_revision_id !== receiverCustody.key.receiverRevisionId ||
      row.receiver_version !== receiverCustody.key.receiverVersion
    ) {
      throw new Error();
    }
    const runOneFetch = withOpenedCbeBirrDepositProofReference(
      {
        ciphertext: row.reference_ciphertext as string,
        masked: row.reference_masked as string,
        ciphertextProfileVersion: 2,
        encryptionKeyVersion: 2,
        providerCode: 'cbe_birr',
      },
      referenceCustody.key,
      referenceCustody.workerProfile,
      referenceCustody.approvedRootProfile,
      (reference) => () =>
        assessor(
          reference,
          {
            receiverRevisionId: row.receiver_revision_id as string,
            receiverVersion: row.receiver_version as number,
            ciphertext: row.receiver_lookup_ciphertext as string,
            masked: row.receiver_lookup_masked as string,
            protectionProfileVersion: 2,
            encryptionKeyVersion: 2,
          },
          receiverCustody.key,
          receiverCustody.workerProfile,
          receiverCustody.approvedRootProfile,
          {
            issuedAt: (row.instruction_issued_at as Date).toISOString(),
            expiresAt: (row.instruction_expires_at as Date).toISOString(),
            submittedAt: (row.proof_submitted_at as Date).toISOString(),
            receiverRevisionActiveAtSubmission: true,
          },
          control,
        ),
    );
    return safeResult(candidateId, await runOneFetch());
  } catch {
    throw new CbeBirrNoMoneyCandidateUnavailableError();
  }
}
