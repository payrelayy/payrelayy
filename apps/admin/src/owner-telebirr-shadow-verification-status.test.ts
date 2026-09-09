import { describe, expect, it, vi } from 'vitest';

import {
  GET_OWNER_TELEBIRR_SHADOW_VERIFICATION_STATUS_SQL,
  OwnerTelebirrShadowVerificationStatusRejectedError,
  OwnerTelebirrShadowVerificationStatusUnavailableError,
  PostgresOwnerTelebirrShadowVerificationStatus,
  type OwnerTelebirrShadowVerificationStatusDatabase,
} from './owner-telebirr-shadow-verification-status.js';

const authUserId = '11111111-1111-4111-8111-111111111111';

function statusRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contract_version: 1,
    verification_mode: 'shadow_no_money',
    pilot_state: 'armed',
    switch_mode: 'dry_run',
    shadow_mode_ready: true,
    proof_count: '4',
    claimable_proof_count: '1',
    active_assignment_count: '1',
    staged_evidence_count: '3',
    completed_count: '2',
    would_verify_count: '1',
    would_review_count: '1',
    would_reject_count: '0',
    quarantined_count: '1',
    checked_at: new Date('2026-09-10T10:00:00.000Z'),
    ...overrides,
  };
}

describe('Owner TeleBirr shadow-verification status adapter', () => {
  it('returns only the exact aggregate no-money projection', async () => {
    const query = vi.fn<OwnerTelebirrShadowVerificationStatusDatabase['query']>(async () => ({
      rows: [statusRow()],
    }));
    const status = new PostgresOwnerTelebirrShadowVerificationStatus({ query });

    await expect(status.status(authUserId)).resolves.toEqual({
      contractVersion: 1,
      verificationMode: 'shadow_no_money',
      pilotState: 'armed',
      switchMode: 'dry_run',
      shadowModeReady: true,
      proofCount: '4',
      claimableProofCount: '1',
      activeAssignmentCount: '1',
      stagedEvidenceCount: '3',
      completedCount: '2',
      wouldVerifyCount: '1',
      wouldReviewCount: '1',
      wouldRejectCount: '0',
      quarantinedCount: '1',
      checkedAt: '2026-09-10T10:00:00.000Z',
    });
    expect(query).toHaveBeenCalledWith(GET_OWNER_TELEBIRR_SHADOW_VERIFICATION_STATUS_SQL, [
      authUserId,
    ]);
    expect(JSON.stringify(await status.status(authUserId))).not.toMatch(
      /player|customer|reference|digest|signature|assignmentId|proofRequestId/u,
    );
    expect(JSON.stringify(await status.status(authUserId))).not.toMatch(
      /settlement_candidate|settled|review_required|definite_reject/u,
    );
  });

  it('rejects malformed actors before querying', async () => {
    const query = vi.fn<OwnerTelebirrShadowVerificationStatusDatabase['query']>();
    const status = new PostgresOwnerTelebirrShadowVerificationStatus({ query });

    await expect(status.status('not-a-uuid')).rejects.toBeInstanceOf(
      OwnerTelebirrShadowVerificationStatusRejectedError,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('fails closed on extra fields, inconsistent gates, or inconsistent aggregates', async () => {
    for (const row of [
      statusRow({ secret_reference: 'sensitive' }),
      statusRow({ shadow_mode_ready: true, switch_mode: 'live' }),
      statusRow({ shadow_mode_ready: false, claimable_proof_count: '1' }),
      statusRow({ completed_count: '3' }),
      statusRow({ claimable_proof_count: '5' }),
      statusRow({ quarantined_count: '4' }),
      statusRow({ completed_count: '2', quarantined_count: '2', staged_evidence_count: '3' }),
    ]) {
      const status = new PostgresOwnerTelebirrShadowVerificationStatus({
        query: async () => ({ rows: [row] }),
      });
      await expect(status.status(authUserId)).rejects.toBeInstanceOf(
        OwnerTelebirrShadowVerificationStatusUnavailableError,
      );
    }
  });

  it('redacts database failure detail into one constant error', async () => {
    const status = new PostgresOwnerTelebirrShadowVerificationStatus({
      query: async () =>
        Promise.reject(new Error('PLAYER-SECRET reference=RAW-TRANSACTION-SECRET')),
    });

    const error = await status.status(authUserId).catch((failure) => failure);
    expect(error).toBeInstanceOf(OwnerTelebirrShadowVerificationStatusUnavailableError);
    expect(String(error)).not.toContain('PLAYER-SECRET');
    expect(String(error)).not.toContain('RAW-TRANSACTION-SECRET');
  });
});
