import { describe, expect, it } from 'vitest';

import {
  evaluatePrivateLiveDepositPilot,
  PRIVATE_LIVE_DEPOSIT_PILOT_REQUIRED_PLAYER_COUNT,
  redactedPrivateLiveDepositPilotDecisionForLog,
} from './index.js';

const players = Object.freeze([
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000005',
]);
const customers = Object.freeze(['10000000-0000-4000-8000-000000000001']);

function valid(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 1,
    evaluatedAt: '2026-08-21T12:00:00.000Z',
    providerCode: 'telebirr',
    submittingCustomerId: customers[0],
    playerAccountId: players[0],
    amountMinor: '2500',
    reservedForPlayerMinor: '0',
    reservedAggregateMinor: '0',
    reservationCount: 0,
    policy: {
      contractVersion: 1,
      pilotRevisionId: '20000000-0000-4000-8000-000000000001',
      configurationDigest:
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      state: 'armed',
      platformCode: 'kemerbet',
      currencyCode: 'ETB',
      providerCodes: ['telebirr'],
      playerAccountIds: [...players],
      submittingCustomerIds: [...customers],
      minimumAmountMinor: '2500',
      maximumPerDepositMinor: '2500',
      maximumPerPlayerMinor: '2500',
      maximumAggregateMinor: '12500',
      maximumReservations: 5,
      activeFrom: '2026-08-21T11:00:00.000Z',
      expiresAt: '2026-08-21T13:00:00.000Z',
    },
    ...overrides,
  };
}

describe('private live deposit pilot policy', () => {
  it('allows only an exact private pilot match and never grants financial authority itself', () => {
    const result = evaluatePrivateLiveDepositPilot(valid());
    expect(result).toEqual({
      contractVersion: 1,
      providerCode: 'telebirr',
      safeFactsOnly: true,
      disposition: 'would_allow',
      reasonCode: 'exact_private_pilot_match',
      advisoryOnly: true,
      sqlAuthorizationAllowed: false,
      databaseWriteAllowed: false,
      reservationAllowed: false,
      claimAllowed: false,
      settlementAllowed: false,
      enqueueAllowed: false,
      executionAllowed: false,
      financialActionAllowed: false,
      blindRetryAllowed: false,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(PRIVATE_LIVE_DEPOSIT_PILOT_REQUIRED_PLAYER_COUNT).toBe(5);
  });

  it.each([
    ['pilot_not_armed', { policy: { ...valid().policy, state: 'draft' } }],
    ['pilot_not_started', { evaluatedAt: '2026-08-21T10:59:59.999Z' }],
    ['pilot_expired', { evaluatedAt: '2026-08-21T13:00:00.000Z' }],
    ['provider_not_allowlisted', { providerCode: 'cbe_birr' }],
    ['customer_not_allowlisted', { submittingCustomerId: '10000000-0000-4000-8000-000000000002' }],
    ['player_not_allowlisted', { playerAccountId: '00000000-0000-4000-8000-000000000006' }],
    ['amount_below_minimum', { amountMinor: '2499' }],
    ['amount_above_per_deposit_cap', { amountMinor: '2501' }],
    ['player_cap_exceeded', { reservedForPlayerMinor: '1' }],
    ['aggregate_cap_exceeded', { reservedAggregateMinor: '10001' }],
    ['reservation_count_exceeded', { reservationCount: 5 }],
  ])('blocks %s', (reasonCode, overrides) => {
    expect(evaluatePrivateLiveDepositPilot(valid(overrides))).toMatchObject({
      disposition: 'would_block',
      reasonCode,
      financialActionAllowed: false,
      blindRetryAllowed: false,
    });
  });

  it.each([
    { policy: { ...valid().policy, playerAccountIds: players.slice(0, 4) } },
    { policy: { ...valid().policy, playerAccountIds: [...players, players[0]] } },
    { policy: { ...valid().policy, submittingCustomerIds: [] } },
    { policy: { ...valid().policy, providerCodes: ['telebirr', 'telebirr'] } },
    { policy: { ...valid().policy, expiresAt: '2026-08-22T11:00:00.001Z' } },
    { policy: { ...valid().policy, maximumPerDepositMinor: '2500001' } },
    {
      policy: {
        ...valid().policy,
        maximumPerDepositMinor: '1000000',
        maximumPerPlayerMinor: '2500001',
        maximumAggregateMinor: '2500001',
      },
    },
    { policy: { ...valid().policy, minimumAmountMinor: '2501' } },
    { policy: { ...valid().policy, maximumReservations: 6 } },
    { policy: { ...valid().policy, maximumAggregateMinor: '12501' } },
    { policy: { ...valid().policy, configurationDigest: `sha256:${'A'.repeat(64)}` } },
    { amountMinor: '25.00' },
    { reservationCount: 0.5 },
    { extra: true },
  ])('rejects malformed or widened input', (overrides) => {
    expect(evaluatePrivateLiveDepositPilot(valid(overrides))).toMatchObject({
      disposition: 'would_block',
      reasonCode: 'invalid_input',
      financialActionAllowed: false,
    });
  });

  it('rejects accessors and proxies without invoking hostile code', () => {
    let getterCalls = 0;
    const accessor = valid();
    Object.defineProperty(accessor, 'amountMinor', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return '2500';
      },
    });
    expect(evaluatePrivateLiveDepositPilot(accessor).reasonCode).toBe('invalid_input');
    expect(getterCalls).toBe(0);

    let trapCalls = 0;
    const proxy = new Proxy(valid(), {
      ownKeys() {
        trapCalls += 1;
        return [];
      },
    });
    expect(evaluatePrivateLiveDepositPilot(proxy).reasonCode).toBe('invalid_input');
    expect(trapCalls).toBe(0);
  });

  it('rejects hostile nested policy and array shapes without invoking them', () => {
    let policyGetterCalls = 0;
    const accessorPolicy = valid();
    Object.defineProperty(accessorPolicy.policy, 'maximumAggregateMinor', {
      enumerable: true,
      get() {
        policyGetterCalls += 1;
        return '12500';
      },
    });
    expect(evaluatePrivateLiveDepositPilot(accessorPolicy).reasonCode).toBe('invalid_input');
    expect(policyGetterCalls).toBe(0);

    let playerTrapCalls = 0;
    const proxiedPlayers = new Proxy([...players], {
      getOwnPropertyDescriptor() {
        playerTrapCalls += 1;
        return undefined;
      },
    });
    expect(
      evaluatePrivateLiveDepositPilot(
        valid({ policy: { ...valid().policy, playerAccountIds: proxiedPlayers } }),
      ).reasonCode,
    ).toBe('invalid_input');
    expect(playerTrapCalls).toBe(0);

    const symbolPolicy = { ...valid().policy };
    Object.defineProperty(symbolPolicy, Symbol('hidden'), { value: true, enumerable: true });
    expect(evaluatePrivateLiveDepositPilot(valid({ policy: symbolPolicy })).reasonCode).toBe(
      'invalid_input',
    );
  });

  it('returns only a fixed redacted decision and never echoes pilot, customer, player, or amounts', () => {
    const input = valid();
    const projection = redactedPrivateLiveDepositPilotDecisionForLog(input);
    const serialized = JSON.stringify(projection);
    expect(projection).toEqual(evaluatePrivateLiveDepositPilot(input));
    expect(serialized).not.toContain(input.policy.pilotRevisionId);
    expect(serialized).not.toContain(input.policy.configurationDigest);
    expect(serialized).not.toContain(input.submittingCustomerId);
    expect(serialized).not.toContain(input.playerAccountId);
    expect(serialized).not.toContain(input.amountMinor);
    expect(Object.isFrozen(projection)).toBe(true);
  });
});
