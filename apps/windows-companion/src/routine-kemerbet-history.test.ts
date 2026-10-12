import { describe, expect, it } from 'vitest';
import type { Page, Response } from 'playwright-core';

import {
  parseRoutineKemerBetHistoryPage,
  scanRoutineKemerBetHistory,
} from './routine-kemerbet-history.js';

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
  const apiResponse = {
    status: () => 200,
    headers: () => ({ date: providerNow }),
    body: async () => Buffer.from(JSON.stringify({ value: { item1: total, item2: rows } })),
    url: () => 'https://admin-api.agt-digi.com/Transaction/DepositHistory?page=1&limit=10',
    request: () => ({ method: () => 'GET' }),
  } as unknown as Response;
  let currentUrl = 'https://agentsystem.admindigi.com/agents';
  return {
    waitForResponse: async (predicate: (value: Response) => boolean) => {
      if (!predicate(apiResponse)) throw new Error('Unexpected History response');
      return apiResponse;
    },
    goto: async (url: string) => {
      currentUrl = url;
    },
    url: () => currentUrl,
  } as unknown as Page;
}

describe('read-only KemerBet deposit history parser', () => {
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

  it('rejects malformed or rounded money, truncated timestamps, and missing IDs', () => {
    for (const override of [
      { amount: 29.005 },
      { amount: -29 },
      { amount: Number.NaN },
      { transactionTime: '2026-10-12 09:33 PM' },
      { transactionTime: '2026-10-12T18:33:14' },
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
    expect(await scanRoutineKemerBetHistory(fakeHistoryPage([row]), '28379330', 2900)).toEqual({
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
      ),
    ).toEqual({ outcome: 'ambiguous' });
    expect(
      await scanRoutineKemerBetHistory(fakeHistoryPage([{ ...row, state: 2 }]), '28379330', 2900),
    ).toEqual({ outcome: 'not_observed' });
  });
});
