import { describe, expect, it } from 'vitest';

import {
  OwnerDryRunFixtureAssessmentRejectedError,
  PostgresOwnerDryRunFixtureAssessments,
} from './owner-dry-run-fixture-assessments.js';

const authUserId = '11111111-1111-4111-8111-111111111111';
const depositIntentId = '22222222-2222-4222-8222-222222222222';
const assessmentId = '33333333-3333-4333-8333-333333333333';
const deposit = {
  amountMinor: '2500',
  currencyCode: 'ETB' as const,
  depositIntentId,
  depositStatus: 'intake_received' as const,
  openedAt: '2026-08-09T10:00:00.000Z',
  paymentDeadline: '2026-08-09T11:00:00.000Z',
  playerId: '28379330',
  providerCode: 'cbe_birr' as const,
  receiverAccountMasked: '****1234',
  submissionStatus: 'received' as const,
  submittedAt: '2026-08-09T10:05:00.000Z',
  submittedReferenceMasked: '***7890',
};

describe('Owner dry-run fixture assessments', () => {
  it('evaluates a redacted fixture and records only the advisory decision', async () => {
    let observed: readonly (number | string)[] = [];
    const assessments = new PostgresOwnerDryRunFixtureAssessments({
      query: async (sql, values) => {
        expect(sql).toContain('app.record_owner_dry_run_fixture_assessment');
        observed = values;
        return {
          rows: [
            {
              already_recorded: false,
              assessed_at: new Date('2026-08-09T10:12:00.000Z'),
              assessment_id: assessmentId,
            },
          ],
        };
      },
    });
    await expect(
      assessments.assess(
        authUserId,
        deposit,
        'valid-completed',
        new Date('2026-08-09T10:12:00.000Z'),
      ),
    ).resolves.toMatchObject({
      assessmentId,
      outcome: 'would_verify',
      reasonCode: 'fixture_completed',
    });
    expect(observed).toEqual([
      authUserId,
      depositIntentId,
      'valid-completed',
      'would_verify',
      'fixture_completed',
    ]);
  });

  it('rejects unknown fixtures before querying PostgreSQL', async () => {
    const assessments = new PostgresOwnerDryRunFixtureAssessments({
      query: async () => {
        throw new Error('must not query');
      },
    });
    await expect(
      assessments.assess(authUserId, deposit, 'real-provider-call', new Date()),
    ).rejects.toThrow(OwnerDryRunFixtureAssessmentRejectedError);
  });

  it('rejects invalid deposit windows before evaluating or querying', async () => {
    const assessments = new PostgresOwnerDryRunFixtureAssessments({
      query: async () => {
        throw new Error('must not query');
      },
    });
    await expect(
      assessments.assess(
        authUserId,
        { ...deposit, openedAt: 'invalid-date' },
        'valid-completed',
        new Date('2026-08-09T10:12:00.000Z'),
      ),
    ).rejects.toThrow(OwnerDryRunFixtureAssessmentRejectedError);
    await expect(
      assessments.assess(
        authUserId,
        { ...deposit, openedAt: deposit.paymentDeadline },
        'valid-completed',
        new Date('2026-08-09T10:12:00.000Z'),
      ),
    ).rejects.toThrow(OwnerDryRunFixtureAssessmentRejectedError);
  });

  it('keeps the completed fixture fresh for the selected dry-run intent', async () => {
    const currentDeposit = {
      ...deposit,
      amountMinor: '10000',
      openedAt: '2026-08-13T10:00:00.000Z',
      paymentDeadline: '2026-08-13T11:00:00.000Z',
      submittedAt: '2026-08-13T10:05:00.000Z',
    };
    const assessments = new PostgresOwnerDryRunFixtureAssessments({
      query: async (_sql, values) => {
        expect(values.slice(2)).toEqual(['valid-completed', 'would_verify', 'fixture_completed']);
        return {
          rows: [
            {
              already_recorded: false,
              assessed_at: new Date('2026-08-13T10:12:00.000Z'),
              assessment_id: assessmentId,
            },
          ],
        };
      },
    });

    await expect(
      assessments.assess(
        authUserId,
        currentDeposit,
        'valid-completed',
        new Date('2026-08-13T10:12:00.000Z'),
      ),
    ).resolves.toMatchObject({ outcome: 'would_verify', reasonCode: 'fixture_completed' });
  });

  it('maps the append-only assessment and review projections', async () => {
    const assessments = new PostgresOwnerDryRunFixtureAssessments({
      query: async (sql) => {
        expect(sql).toContain('app.list_owner_dry_run_fixture_assessments');
        return {
          rows: [
            {
              assessed_at: new Date('2026-08-09T10:12:00.000Z'),
              assessment_id: assessmentId,
              deposit_intent_id: depositIntentId,
              fixture_id: 'pending-status',
              outcome: 'would_review',
              reason_code: 'fixture_status_pending',
              review_decision: 'manual_review_required',
              reviewed_at: new Date('2026-08-09T10:13:00.000Z'),
            },
          ],
        };
      },
    });
    await expect(assessments.list(authUserId)).resolves.toEqual([
      {
        assessedAt: '2026-08-09T10:12:00.000Z',
        assessmentId,
        depositIntentId,
        fixtureId: 'pending-status',
        outcome: 'would_review',
        reasonCode: 'fixture_status_pending',
        reviewDecision: 'manual_review_required',
        reviewedAt: '2026-08-09T10:13:00.000Z',
      },
    ]);
  });
});
