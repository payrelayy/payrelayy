import { describe, expect, it } from 'vitest';
import type { Page, Response } from 'playwright-core';

import {
  parseRoutineKemerBetHistoryPage,
  routineHistoryReadAuthorization,
  scanRoutineKemerBetHistory,
} from './routine-kemerbet-history.js';

const window = {
  from: '2026-10-12T18:33:14.000000Z',
  until: '2026-10-12T18:33:14.999999Z',
} as const;

function response(overrides: Record<string, unknown> = {}) {
  return {
    value: {
      item1: 1,
      item2: [
        {
          walletTransactionId: 110891902,
          transactionId: 19686411,
          transactionTime: '2026-10-12T18:33:14.257728',
          playerId: '28379330',
          amount: 29,
          currencyCode: 'ETB',
          state: 1,
          paymentType: 4,
          transactionType: 1,
          notes: 'Player Epos Deposit',
          ...overrides,
        },
      ],
    },
  };
}

function fakeHistoryPage(rows: readonly Record<string, unknown>[], total = rows.length): Page {
  const providerNow = 'Mon, 12 Oct 2026 18:34:00 GMT';
  const filteredUrl = new URL('https://admin-api.agt-digi.com/Transaction/DepositHistory');
  filteredUrl.searchParams.set('page', '1');
  filteredUrl.searchParams.set('limit', '10');
  filteredUrl.searchParams.set('playerExternalId', '28379330');
  filteredUrl.searchParams.set('from', '2026-10-12T18:32:00.000Z');
  filteredUrl.searchParams.set('to', '2026-10-12T18:35:00.000Z');
  const makeResponse = (url: string) =>
    ({
      status: () => 200,
      headers: () => ({ date: providerNow }),
      body: async () => Buffer.from(JSON.stringify({ value: { item1: total, item2: rows } })),
      url: () => url,
      request: () => ({ method: () => 'GET' }),
    }) as unknown as Response;
  const initialResponse = makeResponse(
    'https://admin-api.agt-digi.com/Transaction/DepositHistory?page=1&limit=10',
  );
  const filteredResponse = makeResponse(filteredUrl.toString());
  let currentUrl = 'https://agentsystem.admindigi.com/agents';
  let responseNumber = 0;
  const target = {
    click: async () => undefined,
    fill: async () => undefined,
    nth: () => target,
    locator: () => target,
    getByRole: () => target,
  };
  return {
    waitForResponse: async (predicate: (value: Response) => boolean) => {
      const candidate = responseNumber++ === 0 ? initialResponse : filteredResponse;
      if (!predicate(candidate)) throw new Error('Unexpected History response');
      return candidate;
    },
    goto: async (url: string) => {
      currentUrl = url;
    },
    url: () => currentUrl,
    locator: () => target,
    getByRole: () => target,
  } as unknown as Page;
}

describe('read-only KemerBet deposit history parser', () => {
  it('binds the read-only browser allowance to the same padded minute window as its UI filter', () => {
    expect(routineHistoryReadAuthorization('28379330', window)).toEqual({
      playerId: '28379330',
      from: '2026-10-12T18:32:00.000Z',
      to: '2026-10-12T18:35:00.000Z',
    });
    expect(() =>
      routineHistoryReadAuthorization('28379330', {
        from: '2026-10-12T18:33:14.000000Z',
        until: '2026-10-12T18:43:14.002000Z',
      }),
    ).toThrow('protected history window');
  });

  it('preserves the API timestamp at microsecond precision and maps distinct provider IDs', () => {
    expect(parseRoutineKemerBetHistoryPage(response())).toEqual({
      total: 1,
      rows: [
        {
          transactionId: '110891902',
          requestId: '19686411',
          occurredAt: '2026-10-12T18:33:14.257728Z',
          occurredAtMs: Date.parse('2026-10-12T18:33:14.257728Z'),
          playerId: '28379330',
          amountMinor: 2900,
          currencyCode: 'ETB',
          approvedDeposit: true,
        },
      ],
    });
  });

  it('normalizes KemerBet variable-width fractional seconds to the six-digit history contract', () => {
    expect(
      parseRoutineKemerBetHistoryPage(response({ transactionTime: '2026-10-12T18:33:14.25772' }))
        ?.rows[0]?.occurredAt,
    ).toBe('2026-10-12T18:33:14.257720Z');
    expect(
      parseRoutineKemerBetHistoryPage(response({ transactionTime: '2026-10-12T18:33:14.2575' }))
        ?.rows[0]?.occurredAt,
    ).toBe('2026-10-12T18:33:14.257500Z');
  });

  it('does not treat a rejected, non-EPOS, or unrelated operation as approved', () => {
    for (const override of [
      { state: 2 },
      { paymentType: 3 },
      { transactionType: 2 },
      { notes: 'Player Epos Withdrawal' },
    ]) {
      expect(parseRoutineKemerBetHistoryPage(response(override))?.rows[0]?.approvedDeposit).toBe(
        false,
      );
    }
  });

  it('does not require credit-only fields from an explicitly unrelated operation', async () => {
    const credit = response().value.item2[0]!;
    const manualDeposit = {
      transactionTime: '2026-10-12T18:33:14.2000',
      state: 1,
      paymentType: 3,
      transactionType: 1,
      notes: 'Manual Deposit',
      playerId: '28379330',
      amount: 29,
      currencyCode: 'ETB',
    };
    const withdrawal = {
      transactionTime: '2026-10-12T18:33:14.1000',
      state: 1,
      paymentType: 4,
      transactionType: 2,
      notes: 'Player Epos Withdrawal',
      playerId: null,
      amount: -29,
      currencyCode: null,
    };
    const result = await scanRoutineKemerBetHistory(
      fakeHistoryPage([credit, manualDeposit, withdrawal]),
      '28379330',
      2900,
      window,
    );
    expect(result).toMatchObject({ outcome: 'exact_match' });
    if (result.outcome === 'exact_match') {
      expect(result.observation.transactionId).toBe('110891902');
      expect(result.observation.approvedHistoryMatchCount).toBe(1);
    }
  });

  it('does not skip a potentially approved credit with an unknown operation marker', () => {
    expect(parseRoutineKemerBetHistoryPage(response({ notes: undefined }))).toBeUndefined();
    expect(parseRoutineKemerBetHistoryPage(response({ state: undefined }))).toBeUndefined();
  });

  it('rejects malformed or rounded money, truncated timestamps, and missing IDs', () => {
    for (const override of [
      { amount: 29.005 },
      { amount: -29 },
      { amount: Number.NaN },
      { transactionTime: '2026-10-12 09:33 PM' },
      { transactionTime: '2026-10-12T18:33:14' },
      { transactionTime: '2026-10-12T18:33:14.' },
      { transactionTime: '2026-10-12T18:33:14.2577280' },
      { transactionTime: '2026-10-12T18:33:14.25772Z' },
      { walletTransactionId: 0 },
      { transactionId: '19686411' },
      { playerId: '28379330\nother' },
      { currencyCode: 'USD' },
    ]) {
      expect(parseRoutineKemerBetHistoryPage(response(override))).toBeUndefined();
    }
  });

  it('accepts exactly one recent approved match from the reviewed History response', async () => {
    const row = response().value.item2[0]!;
    expect(
      await scanRoutineKemerBetHistory(fakeHistoryPage([row]), '28379330', 2900, window),
    ).toEqual({
      outcome: 'exact_match',
      observation: {
        transactionId: '110891902',
        requestId: '19686411',
        occurredAt: '2026-10-12T18:33:14.257728Z',
        playerId: '28379330',
        amountMinor: 2900,
        currencyCode: 'ETB',
        approvedHistoryMatchCount: 1,
      },
    });
  });

  it('finds the fenced exact match when an unrelated row has four fractional digits', async () => {
    const recent = response().value.item2[0]!;
    const older = {
      ...recent,
      walletTransactionId: 110891901,
      transactionId: 19686410,
      transactionTime: '2026-10-12T18:32:14.2575',
      playerId: 'another-player',
    };
    expect(
      await scanRoutineKemerBetHistory(fakeHistoryPage([recent, older]), '28379330', 2900, window),
    ).toEqual({
      outcome: 'exact_match',
      observation: {
        transactionId: '110891902',
        requestId: '19686411',
        occurredAt: '2026-10-12T18:33:14.257728Z',
        playerId: '28379330',
        amountMinor: 2900,
        currencyCode: 'ETB',
        approvedHistoryMatchCount: 1,
      },
    });
  });

  it('never confirms duplicate same-Player/same-amount rows or an unapproved row', async () => {
    const row = response().value.item2[0]!;
    expect(
      await scanRoutineKemerBetHistory(
        fakeHistoryPage([row, { ...row, walletTransactionId: 110891903, transactionId: 19686412 }]),
        '28379330',
        2900,
        window,
      ),
    ).toEqual({ outcome: 'ambiguous' });
    expect(
      await scanRoutineKemerBetHistory(
        fakeHistoryPage([{ ...row, state: 2 }]),
        '28379330',
        2900,
        window,
      ),
    ).toEqual({ outcome: 'not_observed' });
  });
});
