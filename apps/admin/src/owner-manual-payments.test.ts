import { describe, expect, it } from 'vitest';

import {
  OwnerManualPaymentConflictError,
  OwnerManualPaymentRejectedError,
  OwnerManualPaymentUnavailableError,
  PostgresOwnerManualPayments,
} from './owner-manual-payments.js';

const actor = '11111111-1111-4111-8111-111111111111';
const candidate = '22222222-2222-4222-8222-222222222222';
const ownerCase = '33333333-3333-4333-8333-333333333333';
const sms = '44444444-4444-4444-8444-444444444444';

describe('Owner manual payment boundary', () => {
  it('returns the full Player ID for the protected submitted-payment list', async () => {
    const calls: unknown[] = [];
    const service = new PostgresOwnerManualPayments({
      query: async (sql, values) => {
        calls.push([sql, values]);
        return {
          rows: [
            {
              case_id: null,
              candidate_id: candidate,
              legacy_candidate_id: null,
              payment_event_id: null,
              provider_code: 'cbe_birr',
              reference_masked: '***AB12',
              submitted_at: new Date('2026-10-23T09:00:00Z'),
              payment_at: null,
              amount_minor: null,
              receiver_account_id: null,
              receiver_account_masked: null,
              player_id: '12345678',
              payment_status: 'pending',
              status_detail: 'Waiting for incoming SMS',
              owner_case_status: null,
              rejection_reason: null,
              decided_at: null,
              completed_at: null,
              can_approve: true,
              can_reject: true,
            },
          ],
        };
      },
    });
    expect(await service.listSubmittedPayments(actor, 'pending')).toMatchObject([
      { playerId: '12345678', canApprove: true, status: 'pending' },
    ]);
    expect(calls[0]).toEqual([
      expect.stringContaining('app.list_owner_submitted_payments'),
      [actor, 'pending', 25, 0],
    ]);
  });

  it('records approval before outside credit through one atomic database function', async () => {
    const calls: unknown[] = [];
    const service = new PostgresOwnerManualPayments({
      query: async (sql, values) => {
        calls.push([sql, values]);
        return { rows: [{ approved: { caseId: ownerCase, status: 'manually_credited' } }] };
      },
    });
    const receiverAccountId = '55555555-5555-4555-8555-555555555555';
    expect(
      await service.approveForImmediateCredit(actor, candidate, {
        amountMinor: '3300',
        receiverAccountId,
        bankPaymentConfirmed: true,
      }),
    ).toEqual({ caseId: ownerCase, status: 'manually_credited' });
    expect(calls).toEqual([
      [
        expect.stringContaining('app.approve_owner_manual_payment_for_immediate_credit'),
        [actor, candidate, '3300', receiverAccountId, true],
      ],
    ]);
    await expect(
      service.approveForImmediateCredit(actor, candidate, {
        amountMinor: '0',
        receiverAccountId: null,
        bankPaymentConfirmed: false,
      }),
    ).rejects.toBeInstanceOf(OwnerManualPaymentRejectedError);
    expect(calls).toHaveLength(1);
  });

  it('returns only checked Owner system facts from the read-only overview', async () => {
    const service = new PostgresOwnerManualPayments({
      query: async () => ({
        rows: [
          {
            overview: {
              paymentVerificationMode: 'live',
              depositExecutionMode: 'live',
              telebirrReceiptLookupMode: 'disabled',
              telebirrSmsLastReceivedAt: '2026-10-23T09:00:00Z',
              cbeSmsLastReceivedAt: null,
              openDepositJobs: 1,
              deadDepositJobs: 0,
              awaitingManualCredits: 2,
              checkedAt: '2026-10-23T09:05:00Z',
            },
          },
        ],
      }),
    });
    expect(await service.systemOverview(actor)).toMatchObject({
      paymentVerificationMode: 'live',
      telebirrReceiptLookupMode: 'disabled',
      openDepositJobs: 1,
      awaitingManualCredits: 2,
    });
  });

  it('lists masked pending cases and reserves approval without an execution job', async () => {
    const calls: unknown[] = [];
    const service = new PostgresOwnerManualPayments({
      query: async (sql, values) => {
        calls.push([sql, values]);
        if (sql.includes('list_owner_manual_payment_cases'))
          return {
            rows: [
              {
                case_id: null,
                candidate_id: candidate,
                legacy_candidate_id: null,
                payment_event_id: null,
                provider_code: 'cbe_birr',
                reference_masked: '***AB12',
                submitted_at: new Date('2026-10-23T09:00:00Z'),
                payment_at: null,
                amount_minor: null,
                receiver_account_id: null,
                receiver_account_masked: null,
                player_masked: '***5678',
                case_status: 'pending',
                rejection_reason: null,
                decided_at: null,
                completed_at: null,
              },
            ],
          };
        return { rows: [{ decision: { caseId: ownerCase, status: 'awaiting_manual_credit' } }] };
      },
    });
    expect(await service.listCases(actor, 'pending')).toMatchObject([
      { providerCode: 'cbe_birr', referenceMasked: '***AB12', amountMinor: null },
    ]);
    expect(await service.decide(actor, candidate, 'approve', null)).toEqual({
      caseId: ownerCase,
      status: 'awaiting_manual_credit',
    });
    expect(calls[1]).toEqual([
      expect.stringContaining('decide_owner_manual_payment_case'),
      [actor, candidate, 'approve', null],
    ]);
    expect(String(calls[1])).not.toContain('execution_job');
  });

  it('shows an unmatched signed SMS without disclosing its reference', async () => {
    const calls: unknown[] = [];
    const service = new PostgresOwnerManualPayments({
      query: async (sql, values) => {
        calls.push([sql, values]);
        return {
          rows: [
            {
              payment_event_id: sms,
              provider_code: 'telebirr',
              payment_at: new Date('2026-10-23T09:00:00Z'),
              received_at: new Date('2026-10-23T09:00:15Z'),
              amount_minor: '3300',
              receiver_account_masked: '***1234',
              receiver_holder_name: 'Receiving account',
              reference_masked: null,
              candidate_id: null,
              player_masked: null,
              payment_status: 'unmatched',
              case_id: null,
              can_mark_manually_credited: true,
            },
          ],
        };
      },
    });
    expect(
      await service.listSms(
        actor,
        25,
        0,
        'telebirr',
        'unmatched',
        undefined,
        '2026-10-23',
        '2026-10-23',
      ),
    ).toMatchObject([
      {
        referenceMasked: null,
        candidateId: null,
        canMarkManuallyCredited: true,
      },
    ]);
    expect(calls).toEqual([
      [
        expect.stringContaining('list_owner_receiver_sms_inbox_filtered'),
        [actor, 'telebirr', 'unmatched', null, '2026-10-23', '2026-10-23', 25, 0],
      ],
    ]);
    await expect(
      service.listSms(actor, 25, 0, 'telebirr', 'unmatched', 'ABC!'),
    ).rejects.toBeInstanceOf(OwnerManualPaymentRejectedError);
    await expect(
      service.listSms(actor, 25, 0, 'telebirr', 'unmatched', undefined, '2026-02-30'),
    ).rejects.toBeInstanceOf(OwnerManualPaymentRejectedError);
    expect(calls).toHaveLength(1);
  });

  it('keeps low-value SMS visible and available for manual credit', async () => {
    const service = new PostgresOwnerManualPayments({
      query: async () => ({
        rows: [
          {
            payment_event_id: sms,
            provider_code: 'telebirr',
            payment_at: new Date('2026-10-25T21:19:00Z'),
            received_at: new Date('2026-10-25T21:19:15Z'),
            amount_minor: '100',
            receiver_account_masked: '***1234',
            receiver_holder_name: 'Receiving account',
            reference_masked: null,
            candidate_id: null,
            player_masked: null,
            payment_status: 'unmatched',
            case_id: null,
            can_mark_manually_credited: true,
          },
        ],
      }),
    });
    expect(await service.listSms(actor)).toMatchObject([
      { amountMinor: '100', canMarkManuallyCredited: true, status: 'unmatched' },
    ]);
  });

  it('lists older signed TeleBirr submissions in the same manual queue', async () => {
    const service = new PostgresOwnerManualPayments({
      query: async () => ({
        rows: [
          {
            case_id: null,
            candidate_id: null,
            legacy_candidate_id: candidate,
            payment_event_id: null,
            provider_code: 'telebirr',
            reference_masked: '***AB12',
            submitted_at: new Date('2026-10-23T09:00:00Z'),
            payment_at: new Date('2026-10-23T07:59:00Z'),
            amount_minor: '2500',
            receiver_account_id: null,
            receiver_account_masked: null,
            player_masked: '***5678',
            case_status: 'pending',
            rejection_reason: null,
            decided_at: null,
            completed_at: null,
          },
        ],
      }),
    });
    expect(await service.listCases(actor, 'pending')).toMatchObject([
      {
        candidateId: null,
        legacyCandidateId: candidate,
        providerCode: 'telebirr',
      },
    ]);
  });

  it('requires a confirmed completion and passes no-SMS bank details', async () => {
    const calls: unknown[] = [];
    const service = new PostgresOwnerManualPayments({
      query: async (sql, values) => {
        calls.push([sql, values]);
        return { rows: [{ completed: { caseId: ownerCase, status: 'manually_credited' } }] };
      },
    });
    const request = {
      caseId: ownerCase,
      paymentEventId: null,
      amountMinor: '3300',
      receiverAccountId: '55555555-5555-4555-8555-555555555555',
      bankPaymentConfirmed: true,
      playerCreditedConfirmed: true as const,
    };
    expect(await service.complete(actor, request)).toEqual({
      caseId: ownerCase,
      status: 'manually_credited',
    });
    expect(calls[0]).toEqual([
      expect.stringContaining('complete_owner_manual_payment_case'),
      [actor, ownerCase, null, '3300', request.receiverAccountId, true, true],
    ]);
    await expect(
      service.complete(actor, { ...request, playerCreditedConfirmed: false as true }),
    ).rejects.toBeInstanceOf(OwnerManualPaymentRejectedError);
  });

  it('fails closed on unmasked data and duplicate-reference conflicts', async () => {
    const bad = new PostgresOwnerManualPayments({
      query: async () => ({
        rows: [
          {
            case_id: null,
            candidate_id: candidate,
            legacy_candidate_id: null,
            payment_event_id: null,
            provider_code: 'telebirr',
            reference_masked: 'FULL_REFERENCE',
            submitted_at: new Date(),
            payment_at: null,
            amount_minor: null,
            receiver_account_id: null,
            receiver_account_masked: null,
            player_masked: '***5678',
            case_status: 'pending',
            rejection_reason: null,
            decided_at: null,
            completed_at: null,
          },
        ],
      }),
    });
    await expect(bad.listCases(actor, 'pending')).rejects.toBeInstanceOf(
      OwnerManualPaymentUnavailableError,
    );
    const conflict = new PostgresOwnerManualPayments({
      query: async () => {
        throw Object.assign(new Error('duplicate'), { code: '23505' });
      },
    });
    await expect(conflict.decide(actor, candidate, 'approve', null)).rejects.toBeInstanceOf(
      OwnerManualPaymentConflictError,
    );
  });
});
