import type { Page, Response } from 'playwright-core';
import type { RoutineDepositHistoryWindow } from '@fetanagent/agent-platform-companion-execution-contracts';

import type { RoutineHistoryReadAuthorization } from './request-guard.js';

const HISTORY_URL = 'https://agentsystem.admindigi.com/payments/history';
const HISTORY_API_ORIGIN = 'https://admin-api.agt-digi.com';
const HISTORY_API_PATH = '/Transaction/DepositHistory';
const MAX_PAGES = 20;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_HISTORY_WINDOW_MS = 10 * 60_000;
const HISTORY_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u;
// KemerBet serializes UTC fractional seconds without fixed-width zero padding. A valid
// unrelated row with four digits must not invalidate the entire reconciliation page.
const UTC_FRACTIONAL_MICROSECOND = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{1,6})$/u;
const NUMERIC_ID = /^[0-9]{6,20}$/u;
const PLAYER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

export interface RoutineHistoryObservation {
  readonly transactionId: string;
  readonly requestId: string;
  readonly occurredAt: string;
  readonly playerId: string;
  readonly amountMinor: number;
  readonly currencyCode: 'ETB';
  readonly approvedHistoryMatchCount: 1;
}

export type RoutineHistoryScan =
  | { readonly outcome: 'not_observed' }
  | { readonly outcome: 'ambiguous' }
  | { readonly outcome: 'exact_match'; readonly observation: RoutineHistoryObservation };

interface HistoryRowBase {
  readonly occurredAt: string;
  readonly occurredAtMs: number;
}

interface ApprovedHistoryRow extends HistoryRowBase {
  readonly transactionId: string;
  readonly requestId: string;
  readonly playerId: string;
  readonly amountMinor: number;
  readonly currencyCode: 'ETB';
  readonly approvedDeposit: true;
}

type HistoryRow = ApprovedHistoryRow | (HistoryRowBase & { readonly approvedDeposit: false });

interface HistoryPage {
  readonly total: number;
  readonly rows: readonly HistoryRow[];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function moneyMinor(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const match = /^([0-9]{1,5})(?:\.([0-9]{1,2}))?$/u.exec(String(value));
  if (!match?.[1]) return undefined;
  const minor = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(minor) ? minor : undefined;
}

function numericId(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return undefined;
  const id = String(value);
  return NUMERIC_ID.test(id) ? id : undefined;
}

/** Parse only the reviewed, read-only EPOS deposit history response. Never log row contents. */
export function parseRoutineKemerBetHistoryPage(candidate: unknown): HistoryPage | undefined {
  if (!record(candidate) || !record(candidate.value)) return undefined;
  const total = candidate.value.item1;
  const rawRows = candidate.value.item2;
  if (
    !Number.isSafeInteger(total) ||
    (total as number) < 0 ||
    !Array.isArray(rawRows) ||
    rawRows.length > 10
  )
    return undefined;
  const rows: HistoryRow[] = [];
  for (const raw of rawRows) {
    if (!record(raw)) return undefined;
    const rawTime = raw.transactionTime;
    const timeMatch = typeof rawTime === 'string' ? UTC_FRACTIONAL_MICROSECOND.exec(rawTime) : null;
    if (!timeMatch) return undefined;
    // Preserve the provider's UTC instant at the six-digit wire precision, without rounding.
    const occurredAt = `${timeMatch[1]}.${timeMatch[2]!.padEnd(6, '0')}Z`;
    const occurredAtMs = Date.parse(occurredAt);
    if (!Number.isSafeInteger(occurredAtMs) || occurredAtMs <= 0) return undefined;
    const approvedDeposit =
      raw.state === 1 &&
      raw.paymentType === 4 &&
      raw.transactionType === 1 &&
      raw.notes === 'Player Epos Deposit';
    if (!approvedDeposit) {
      const clearlyOtherOperation =
        (typeof raw.state === 'number' && raw.state !== 1) ||
        (typeof raw.paymentType === 'number' && raw.paymentType !== 4) ||
        (typeof raw.transactionType === 'number' && raw.transactionType !== 1) ||
        (typeof raw.notes === 'string' && raw.notes !== 'Player Epos Deposit');
      if (!clearlyOtherOperation) return undefined;
      // Other activity on the same agent account may have different ID, Player, or amount
      // fields. Its timestamp still participates in pagination/order validation, but it
      // cannot confirm a FetanAgent credit. A possible EPOS credit stays strictly parsed.
      rows.push(Object.freeze({ occurredAt, occurredAtMs, approvedDeposit: false }));
      continue;
    }
    const transactionId = numericId(raw.walletTransactionId);
    const requestId = numericId(raw.transactionId);
    const playerId = raw.playerId;
    const amountMinor = moneyMinor(raw.amount);
    if (
      !transactionId ||
      !requestId ||
      typeof playerId !== 'string' ||
      !PLAYER_ID.test(playerId) ||
      amountMinor === undefined ||
      raw.currencyCode !== 'ETB'
    )
      return undefined;
    rows.push(
      Object.freeze({
        transactionId,
        requestId,
        occurredAt,
        occurredAtMs,
        playerId,
        amountMinor,
        currencyCode: 'ETB',
        approvedDeposit: true,
      }),
    );
  }
  return Object.freeze({ total: total as number, rows });
}

function isHistoryResponse(
  response: Response,
  pageNumber: number,
  playerId?: string,
  from?: string,
  until?: string,
): boolean {
  try {
    const url = new URL(response.url());
    return (
      response.request().method() === 'GET' &&
      url.origin === HISTORY_API_ORIGIN &&
      url.pathname === HISTORY_API_PATH &&
      url.searchParams.get('page') === String(pageNumber) &&
      url.searchParams.get('limit') === '10' &&
      (playerId === undefined ||
        (url.searchParams.get('playerExternalId') === playerId &&
          url.searchParams.get('from') === from &&
          url.searchParams.get('to') === until))
    );
  } catch {
    return false;
  }
}

function localMinute(ms: number): string {
  const value = new Date(ms);
  const hours = value.getHours();
  const hour12 = hours % 12 || 12;
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')} ${String(hour12).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

export function routineHistoryReadAuthorization(
  playerId: string,
  window: RoutineDepositHistoryWindow,
): RoutineHistoryReadAuthorization {
  const fromMs = Date.parse(window?.from ?? '');
  const untilMs = Date.parse(window?.until ?? '');
  if (
    !PLAYER_ID.test(playerId) ||
    !HISTORY_TIME.test(window?.from ?? '') ||
    !HISTORY_TIME.test(window?.until ?? '') ||
    !Number.isSafeInteger(fromMs) ||
    !Number.isSafeInteger(untilMs) ||
    fromMs <= 0 ||
    untilMs < fromMs ||
    untilMs - fromMs > MAX_HISTORY_WINDOW_MS
  )
    throw new Error('The protected history window is invalid.');

  // The History picker has minute precision. Bind the browser allowance to precisely the
  // same padded window that the scan will select, rather than to an arbitrary Player query.
  return Object.freeze({
    playerId,
    from: new Date(Math.floor(fromMs / 60_000) * 60_000 - 60_000).toISOString(),
    to: new Date(Math.ceil(untilMs / 60_000) * 60_000 + 60_000).toISOString(),
  });
}

async function applyHistoryWindowFilter(
  page: Page,
  authorization: RoutineHistoryReadAuthorization,
): Promise<{ readonly from: string; readonly until: string; readonly response: Response }> {
  // KemerBet's picker displays local browser time and sends UTC ISO query parameters.
  // Include one full minute on each side; exact matching below still uses the server fence.
  const fromMinute = Date.parse(authorization.from);
  const untilMinute = Date.parse(authorization.to);
  const from = authorization.from;
  const until = authorization.to;
  await page.locator('.rt--filters-button').click({ timeout: 5_000 });
  const drawer = page.locator('.ant-drawer-content.rt--filters-drawer');
  await drawer.locator('#playerExternalId').fill(authorization.playerId);
  await drawer.locator('input[date-range="start"]').nth(1).fill(localMinute(fromMinute));
  await page.getByRole('button', { name: 'OK', exact: true }).click({ timeout: 5_000 });
  await drawer.locator('input[date-range="end"]').nth(1).fill(localMinute(untilMinute));
  await page.getByRole('button', { name: 'OK', exact: true }).click({ timeout: 5_000 });
  const responsePromise = page.waitForResponse(
    (response) => isHistoryResponse(response, 1, authorization.playerId, from, until),
    { timeout: 15_000 },
  );
  await drawer.getByRole('button', { name: 'Apply' }).click({ timeout: 5_000 });
  return { from, until, response: await responsePromise };
}

async function readHistoryPage(response: Response): Promise<HistoryPage> {
  if (response.status() !== 200) throw new Error('KemerBet history unavailable.');
  const bytes = await response.body();
  try {
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error();
    const page = parseRoutineKemerBetHistoryPage(JSON.parse(bytes.toString('utf8')));
    if (!page) throw new Error();
    return page;
  } catch {
    throw new Error('KemerBet history shape changed.');
  } finally {
    bytes.fill(0);
  }
}

/**
 * Reads the same authenticated deposit History page as the operator. The caller exclusively owns
 * the guarded browser while this runs and must return to /agents and re-verify account identity.
 * No Transfer or other provider mutation is performed here.
 */
export async function scanRoutineKemerBetHistory(
  page: Page,
  playerId: string,
  amountMinor: number,
  window: RoutineDepositHistoryWindow,
): Promise<RoutineHistoryScan> {
  const authorization = routineHistoryReadAuthorization(playerId, window);
  const untilMs = Date.parse(window.until);
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 10_000 || amountMinor > 2_500_000)
    throw new Error('The protected history window is invalid.');

  const initialResponse = page.waitForResponse((response) => isHistoryResponse(response, 1), {
    timeout: 15_000,
  });
  await page.goto(HISTORY_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  await initialResponse;
  if (page.url().split('#')[0] !== HISTORY_URL) throw new Error('KemerBet history redirected.');
  const filter = await applyHistoryWindowFilter(page, authorization);
  let expectedTotal: number | undefined;
  let previousOldestMs = Number.POSITIVE_INFINITY;
  const matches: ApprovedHistoryRow[] = [];
  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
    let response: Response;
    if (pageNumber === 1) {
      response = filter.response;
    } else {
      const responsePromise = page.waitForResponse(
        (candidate) =>
          isHistoryResponse(candidate, pageNumber, playerId, filter.from, filter.until),
        { timeout: 15_000 },
      );
      const next = page.locator('.ant-pagination-next:not(.ant-pagination-disabled)');
      if ((await next.count()) !== 1) throw new Error('KemerBet history pagination changed.');
      await next.click({ timeout: 5_000 });
      response = await responsePromise;
    }
    const providerDate = response.headers()['date'];
    const providerNowMs = providerDate === undefined ? Number.NaN : Date.parse(providerDate);
    if (!Number.isSafeInteger(providerNowMs) || providerNowMs <= 0 || providerNowMs < untilMs)
      throw new Error('KemerBet history clock is unavailable.');
    const historyPage = await readHistoryPage(response);
    if (page.url().split('#')[0] !== HISTORY_URL) throw new Error('KemerBet history redirected.');
    if (expectedTotal === undefined) expectedTotal = historyPage.total;
    if (
      historyPage.total !== expectedTotal ||
      historyPage.rows.length !== Math.min(10, Math.max(0, expectedTotal - (pageNumber - 1) * 10))
    ) {
      throw new Error('KemerBet history pagination changed.');
    }
    if (historyPage.rows.length === 0) {
      if (pageNumber === 1 && historyPage.total === 0) return { outcome: 'not_observed' };
      throw new Error('KemerBet history page is incomplete.');
    }
    const oldestMs = Math.min(...historyPage.rows.map((row) => row.occurredAtMs));
    const newestMs = Math.max(...historyPage.rows.map((row) => row.occurredAtMs));
    if (newestMs > previousOldestMs) throw new Error('KemerBet history order changed.');
    previousOldestMs = oldestMs;
    for (const row of historyPage.rows) {
      if (!row.approvedDeposit) continue;
      if (
        row.occurredAt >= window.from &&
        row.occurredAt <= window.until &&
        row.playerId === playerId &&
        row.amountMinor === amountMinor
      )
        matches.push(row);
    }
    if (pageNumber * 10 >= historyPage.total) {
      if (matches.length === 0) return { outcome: 'not_observed' };
      if (matches.length !== 1) return { outcome: 'ambiguous' };
      const match = matches[0]!;
      return Object.freeze({
        outcome: 'exact_match',
        observation: Object.freeze({
          transactionId: match.transactionId,
          requestId: match.requestId,
          occurredAt: match.occurredAt,
          playerId: match.playerId,
          amountMinor: match.amountMinor,
          currencyCode: 'ETB',
          approvedHistoryMatchCount: 1,
        }),
      });
    }
  }
  throw new Error('KemerBet history window exceeds the bounded scan.');
}
