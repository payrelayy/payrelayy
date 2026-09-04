import { describe, expect, it, vi } from 'vitest';

import {
  GET_OWNER_COMPANION_LOOKUP_STATUS_SQL,
  ISSUE_OWNER_COMPANION_LOOKUP_SQL,
  OwnerCompanionLookupNotReadyError,
  OwnerCompanionLookupRejectedError,
  OwnerCompanionLookupUnavailableError,
  PostgresOwnerCompanionLookup,
} from './owner-companion-exact-five-lookup.js';

const authUserId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const assignmentId = '33333333-3333-4333-8333-333333333333';
const signerKeyId = 'companion_server_signer_2026_01';
const issuedAt = new Date('2026-09-05T06:00:00.000Z');
const expiresAt = new Date('2026-09-05T06:10:00.000Z');

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    assignment_id: assignmentId,
    assignment_state: 'pending',
    issued_at: issuedAt,
    expires_at: expiresAt,
    found_count: null,
    not_found_count: null,
    review_required_count: null,
    completed_at: null,
    ...overrides,
  };
}

describe('Owner exact-five companion lookup', () => {
  it('issues one idempotent, redacted, find-only assignment through the exact SQL boundary', async () => {
    const query = vi.fn(async () => ({ rows: [{ ...pendingRow(), replayed: false }] }));
    const lookup = new PostgresOwnerCompanionLookup({ query }, signerKeyId);

    await expect(lookup.issue(authUserId, requestId)).resolves.toEqual({
      assignmentId,
      state: 'pending',
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      playerCount: 5,
      platformCode: 'kemerbet',
      lookupMode: 'find_only',
      identifiersRedacted: true,
      transferDisabled: true,
      moneyMovementAllowed: false,
      moneyMoved: false,
      alreadyIssued: false,
    });
    expect(query).toHaveBeenCalledWith(ISSUE_OWNER_COMPANION_LOOKUP_SQL, [
      authUserId,
      requestId,
      signerKeyId,
    ]);
  });

  it('returns only aggregate terminal status and never Player IDs', async () => {
    const completedAt = new Date('2026-09-05T06:04:00.000Z');
    const query = vi.fn(async () => ({
      rows: [
        pendingRow({
          assignment_state: 'review_required',
          found_count: 3,
          not_found_count: 1,
          review_required_count: 1,
          completed_at: completedAt,
        }),
      ],
    }));
    const lookup = new PostgresOwnerCompanionLookup({ query }, signerKeyId);

    const status = await lookup.status(authUserId);
    expect(query).toHaveBeenCalledWith(GET_OWNER_COMPANION_LOOKUP_STATUS_SQL, [authUserId]);
    expect(status).toMatchObject({
      state: 'review_required',
      foundCount: 3,
      notFoundCount: 1,
      reviewRequiredCount: 1,
      completedAt: completedAt.toISOString(),
      identifiersRedacted: true,
      transferDisabled: true,
      moneyMovementAllowed: false,
      moneyMoved: false,
    });
    expect(status).not.toHaveProperty('playerIds');
    expect(status).not.toHaveProperty('amount');
    expect(status).not.toHaveProperty('notes');
    expect(status).not.toHaveProperty('transfer');
  });

  it('reports no status when no assignment exists and preserves idempotent replay state', async () => {
    const lookup = new PostgresOwnerCompanionLookup(
      {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [{ ...pendingRow(), replayed: true }] })
          .mockResolvedValueOnce({ rows: [] }),
      },
      signerKeyId,
    );
    await expect(lookup.issue(authUserId, requestId)).resolves.toMatchObject({
      alreadyIssued: true,
    });
    await expect(lookup.status(authUserId)).resolves.toBeUndefined();
  });

  it('rejects malformed authority input before querying', async () => {
    const query = vi.fn();
    expect(() => new PostgresOwnerCompanionLookup({ query }, 'short')).toThrow(
      OwnerCompanionLookupRejectedError,
    );
    const lookup = new PostgresOwnerCompanionLookup({ query }, signerKeyId);
    await expect(lookup.issue('not-a-user', requestId)).rejects.toThrow(
      OwnerCompanionLookupRejectedError,
    );
    await expect(lookup.issue(authUserId, 'not-a-v4-request')).rejects.toThrow(
      OwnerCompanionLookupRejectedError,
    );
    await expect(lookup.status('not-a-user')).rejects.toThrow(OwnerCompanionLookupRejectedError);
    expect(query).not.toHaveBeenCalled();
  });

  it('fails closed for extra, proxied, or internally inconsistent database rows', async () => {
    const candidates = [
      { ...pendingRow(), replayed: false, unexpected: true },
      new Proxy({ ...pendingRow(), replayed: false }, {}),
      {
        ...pendingRow({
          assignment_state: 'completed',
          found_count: 5,
          not_found_count: 1,
          review_required_count: 0,
          completed_at: new Date('2026-09-05T06:03:00.000Z'),
        }),
        replayed: false,
      },
      {
        ...pendingRow({
          assignment_state: 'completed',
          found_count: null,
          not_found_count: null,
          review_required_count: null,
          completed_at: new Date('2026-09-05T06:03:00.000Z'),
        }),
        replayed: false,
      },
    ];
    for (const candidate of candidates) {
      const lookup = new PostgresOwnerCompanionLookup(
        { query: async () => ({ rows: [candidate] }) },
        signerKeyId,
      );
      await expect(lookup.issue(authUserId, requestId)).rejects.toThrow(
        OwnerCompanionLookupUnavailableError,
      );
    }
  });

  it('separates guarded readiness rejection from database unavailability', async () => {
    for (const code of ['P0001', '23505']) {
      const lookup = new PostgresOwnerCompanionLookup(
        {
          query: async () => {
            throw Object.assign(new Error(), { code });
          },
        },
        signerKeyId,
      );
      await expect(lookup.issue(authUserId, requestId)).rejects.toThrow(
        OwnerCompanionLookupNotReadyError,
      );
    }
    const unavailable = new PostgresOwnerCompanionLookup(
      {
        query: async () => {
          throw new Error();
        },
      },
      signerKeyId,
    );
    await expect(unavailable.issue(authUserId, requestId)).rejects.toThrow(
      OwnerCompanionLookupUnavailableError,
    );
  });
});
