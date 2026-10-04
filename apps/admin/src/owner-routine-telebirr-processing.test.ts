import { describe, expect, it, vi } from 'vitest';
import {
  decodeOwnerRoutineProcessingStatus,
  OwnerRoutineProcessingConflictError,
  OwnerRoutineProcessingRejectedError,
  OwnerRoutineProcessingUnavailableError,
  PostgresOwnerRoutineTelebirrProcessing,
} from './owner-routine-telebirr-processing.js';

const actor = '11111111-1111-4111-8111-111111111111';
const account = '22222222-2222-4222-8222-222222222222';
const request = '33333333-3333-4333-8333-333333333333';
const baseline = {
  configurationState: 'not_configured',
  executionEnabled: false,
  authorizationId: null,
  revision: null,
  platformAgentAccountId: null,
  authorizedAt: null,
  changedAt: null,
  policy: null,
};
const configured = {
  configurationState: 'authorized',
  executionEnabled: false,
  authorizationId: request,
  revision: '1',
  platformAgentAccountId: account,
  authorizedAt: '2026-10-05T00:00:00Z',
  changedAt: '2026-10-05T00:00:00Z',
  policy: {
    mode: 'routine_production',
    version: 1,
    provider: 'telebirr',
    platformCode: 'kemerbet',
    currencyCode: 'ETB',
    minimumAmountMinor: 2500,
    maximumAmountMinor: 2500000,
    freshnessWindowSeconds: 3600,
    playerScope: 'all_active_deposit_eligible',
    playerOwnershipRequired: false,
    dailyQuotaMinor: null,
    successfulDepositQuota: null,
    maxConcurrentDeposits: 1,
    amountSource: 'official_receipt_settled_amount',
  },
};

describe('persistent Owner routine processing policy', () => {
  it('returns unconfigured and persistent policy projections, never a live execution receipt', () => {
    expect(decodeOwnerRoutineProcessingStatus(baseline)).toEqual(baseline);
    expect(decodeOwnerRoutineProcessingStatus(configured)).toEqual(configured);
    expect(
      decodeOwnerRoutineProcessingStatus({ ...configured, configurationState: 'stopped' }),
    ).toMatchObject({ configurationState: 'stopped' });
    expect(Object.isFrozen(decodeOwnerRoutineProcessingStatus(configured).policy)).toBe(true);
    expect(configured).not.toHaveProperty('expiresAt');
  });

  it('uses only parameterized configuration procedures for get, save and stop', async () => {
    const query = vi.fn(async () => ({ rows: [{ configuration: configured }] }));
    const policy = new PostgresOwnerRoutineTelebirrProcessing({ query });
    await policy.get(actor);
    await policy.save(actor, account, request);
    await policy.stop(actor, request);
    expect(query.mock.calls.map((call) => call)).toHaveLength(3);
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('get_owner_routine_telebirr_processing($1::uuid)'),
      [actor],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        'save_owner_routine_telebirr_processing($1::uuid, $2::uuid, $3::uuid)',
      ),
      [actor, account, request],
    );
    expect(query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('stop_owner_routine_telebirr_processing($1::uuid, $2::uuid)'),
      [actor, request],
    );
    expect(query.mock.calls.flat().join(' ')).not.toMatch(
      /lease_|fence_|transfer_|activate_|enable_/u,
    );
  });

  it.each([
    ['execution flag', { ...configured, executionEnabled: true }],
    ['expiry', { ...configured, expiresAt: '2026-10-06T00:00:00Z' }],
    ['extra secret', { ...configured, credential: 'not-allowed' }],
    ['invalid revision', { ...configured, revision: '9223372036854775808' }],
    ['unconfigured identity', { ...configured, configurationState: 'not_configured' }],
    ['bad date', { ...configured, changedAt: 'bad' }],
    ['unknown state', { ...configured, configurationState: 'live' }],
    ['missing identity', { ...configured, authorizationId: null }],
    ['daily quota', { ...configured, policy: { ...configured.policy, dailyQuotaMinor: 12500 } }],
    [
      'five deposit quota',
      { ...configured, policy: { ...configured.policy, successfulDepositQuota: 5 } },
    ],
    [
      'pilot Players',
      { ...configured, policy: { ...configured.policy, playerScope: 'five_players' } },
    ],
    [
      'parallel actions',
      { ...configured, policy: { ...configured.policy, maxConcurrentDeposits: 2 } },
    ],
    ['wrong amount', { ...configured, policy: { ...configured.policy, maximumAmountMinor: 2500 } }],
    [
      'customer amount',
      { ...configured, policy: { ...configured.policy, amountSource: 'user_entered' } },
    ],
    [
      'payer ownership',
      { ...configured, policy: { ...configured.policy, playerOwnershipRequired: true } },
    ],
  ])('rejects %s instead of presenting it as routine authority', (_label, candidate) => {
    expect(() => decodeOwnerRoutineProcessingStatus(candidate)).toThrow(
      OwnerRoutineProcessingUnavailableError,
    );
  });

  it('rejects invalid identifiers before any query', () => {
    const query = vi.fn();
    const policy = new PostgresOwnerRoutineTelebirrProcessing({ query });
    expect(() => policy.get('bad')).toThrow(OwnerRoutineProcessingRejectedError);
    expect(() => policy.save(actor, 'bad', request)).toThrow(OwnerRoutineProcessingRejectedError);
    expect(() => policy.stop(actor, 'bad')).toThrow(OwnerRoutineProcessingRejectedError);
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    ['42501', OwnerRoutineProcessingRejectedError],
    ['22023', OwnerRoutineProcessingRejectedError],
    ['P0001', OwnerRoutineProcessingConflictError],
    ['42P01', OwnerRoutineProcessingUnavailableError],
    ['08006', OwnerRoutineProcessingUnavailableError],
  ])('redacts database error %s', async (code, expected) => {
    const policy = new PostgresOwnerRoutineTelebirrProcessing({
      query: async () => {
        throw { code, detail: 'protected-information' };
      },
    });
    await expect(policy.get(actor)).rejects.toBeInstanceOf(expected);
    await expect(policy.get(actor)).rejects.not.toMatchObject({ detail: 'protected-information' });
  });

  it.each([
    { rows: [] },
    { rows: [{ configuration: baseline }, { configuration: baseline }] },
    { rows: [{ configuration: null }] },
  ])('rejects malformed result cardinality or data', async ({ rows }) => {
    const policy = new PostgresOwnerRoutineTelebirrProcessing({ query: async () => ({ rows }) });
    await expect(policy.get(actor)).rejects.toBeInstanceOf(OwnerRoutineProcessingUnavailableError);
  });
});
