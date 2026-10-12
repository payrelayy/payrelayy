import type { Page, Response } from 'playwright-core';

const HISTORY_URL = 'https://agentsystem.admindigi.com/payments/history';
const HISTORY_API_ORIGIN = 'https://admin-api.agt-digi.com';
const HISTORY_API_PATH = '/Transaction/DepositHistory';
const MAX_PAGES = 20;
const MAX_RESPONSE_BYTES = 256 * 1024;
const RECENT_HISTORY_MS = 5 * 60_000;
const UTC_FRACTIONAL_MICROSECOND = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{5,6})$/u;
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

interface HistoryRow {
  readonly transactionId: string;
  readonly requestId: string;
  readonly occurredAt: string;
  readonly occurredAtMs: number;
  readonly playerId: string;
  readonly amountMinor: number;
  readonly currencyCode: 'ETB';
  readonly approvedDeposit: boolean;
}

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
    const transactionId = numericId(raw.walletTransactionId);
    const requestId = numericId(raw.transactionId);
    const playerId = raw.playerId;
    const amountMinor = moneyMinor(raw.amount);
    const rawTime = raw.transactionTime;
    const timeMatch = typeof rawTime === 'string' ? UTC_FRACTIONAL_MICROSECOND.exec(rawTime) : null;
    if (
      !transactionId ||
      !requestId ||
      typeof playerId !== 'string' ||
      !PLAYER_ID.test(playerId) ||
      amountMinor === undefined ||
      raw.currencyCode !== 'ETB' ||
      !timeMatch
    )
      return undefined;
    // KemerBet returns five or six fractional digits. Keep the wire contract's
    // six-digit UTC precision without rounding the provider's timestamp.
    const occurredAt = `${timeMatch[1]}.${timeMatch[2]!.padEnd(6, '0')}Z`;
    const occurredAtMs = Date.parse(occurredAt);
    if (!Number.isSafeInteger(occurredAtMs) || occurredAtMs <= 0) return undefined;
    rows.push(
      Object.freeze({
        transactionId,
        requestId,
        occurredAt,
        occurredAtMs,
        playerId,
        amountMinor,
        currencyCode: 'ETB',
        approvedDeposit:
          raw.state === 1 &&
          raw.paymentType === 4 &&
          raw.transactionType === 1 &&
          raw.notes === 'Player Epos Deposit',
      }),
    );
  }
  return Object.freeze({ total: total as number, rows });
}

function isHistoryResponse(response: Response, pageNumber: number): boolean {
  try {
    const url = new URL(response.url());
    return (
      response.request().method() === 'GET' &&
      url.origin === HISTORY_API_ORIGIN &&
      url.pathname === HISTORY_API_PATH &&
      url.searchParams.get('page') === String(pageNumber) &&
      url.searchParams.get('limit') === '10'
    );
  } catch {
    return false;
  }
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
): Promise<RoutineHistoryScan> {
  if (
    !PLAYER_ID.test(playerId) ||
    !Number.isSafeInteger(amountMinor) ||
    amountMinor < 2_500 ||
    amountMinor > 2_500_000
  )
    throw new Error('The protected history window is invalid.');

  let scanFromMs: number | undefined;
  let scanUntilMs: number | undefined;
  let expectedTotal: number | undefined;
  let previousOldestMs = Number.POSITIVE_INFINITY;
  const matches: HistoryRow[] = [];
  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
    const responsePromise = page.waitForResponse(
      (response) => isHistoryResponse(response, pageNumber),
      { timeout: 15_000 },
    );
    if (pageNumber === 1) {
      await page.goto(HISTORY_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    } else {
      const next = page.locator('.ant-pagination-next:not(.ant-pagination-disabled)');
      if ((await next.count()) !== 1) throw new Error('KemerBet history pagination changed.');
      await next.click({ timeout: 5_000 });
    }
    const response = await responsePromise;
    if (scanFromMs === undefined) {
      const providerDate = response.headers()['date'];
      const providerNowMs = providerDate === undefined ? Number.NaN : Date.parse(providerDate);
      if (!Number.isSafeInteger(providerNowMs) || providerNowMs <= 0)
        throw new Error('KemerBet history clock is unavailable.');
      scanFromMs = providerNowMs - RECENT_HISTORY_MS;
      scanUntilMs = providerNowMs + 1_000;
    }
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
      if (
        row.occurredAtMs >= scanFromMs &&
        row.occurredAtMs <= scanUntilMs! &&
        row.playerId === playerId &&
        row.amountMinor === amountMinor &&
        row.approvedDeposit
      )
        matches.push(row);
    }
    if (oldestMs < scanFromMs || pageNumber * 10 >= historyPage.total) {
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
