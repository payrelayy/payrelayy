import { isProxy } from 'node:util/types';

import {
  KEMERBET_AGENT_API_ORIGIN,
  KEMERBET_AGENT_AUTHENTICATED_CANDIDATE_URL,
  KEMERBET_AGENT_PLAYER_LOOKUP_PATH,
  KEMERBET_LOCAL_SESSION_FAILURE_CAPTCHA_SELECTOR,
  KEMERBET_LOCAL_SESSION_FAILURE_SIGN_IN_FORM_SELECTOR,
  validateKemerBetReadOnlyPlayerLookupResponse,
} from '@fetanagent/agent-platform-kemerbet';
import type { Locator, Page, Response } from 'playwright-core';

import type { MutableLocalKemerBetLookupAuthorization } from './local-kemerbet-lookup.js';
import { KEMERBET_DEPOSIT_PATH } from './request-guard.js';
import type {
  ConsumedLocalKemerBetDepositAuthorization,
  LocalKemerBetDepositAuthorization,
  LocalKemerBetDepositDispatchOutcome,
} from './provider-route.js';

const PLAYER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const EXACT_AMOUNT_TEXT = '25.00' as const;
const TIMEOUT_MS = 30_000;
const DEPOSIT_URL = `${KEMERBET_AGENT_API_ORIGIN}${KEMERBET_DEPOSIT_PATH}`;

const selectors = Object.freeze({
  financialActionsTrigger: '.rt--header-right .rt--header-actions-content-icon:has(.icon-transfer)',
  toPlayerTile: '.rt--transfer-item:has(.icon-player)',
  findBySelectedValue: '.ant-modal-content .ant-select-selection-item',
  playerIdInput: '.ant-modal-content [data-placeholder="Enter Player ID"] input',
  lookupRoot: '.ant-modal-content .rt--transfer-player-info',
  resolvedIdentity: '.rt--transfer-player-info-details > .rt--flex:nth-child(1) > b',
  currencyCode: '.rt--transfer-player-info-details > .rt--flex:nth-child(2) > b',
  amountInput: '.ant-modal-content [data-placeholder="Enter Amount"] input',
  notesInput: '.ant-modal-content [data-placeholder="Enter Notes"] textarea',
} as const);

interface PendingDeposit {
  readonly internalPlayerId: number;
  readonly isFresh: () => boolean;
  readonly settle: (outcome: LocalKemerBetDepositDispatchOutcome) => void;
}

export interface MutableLocalKemerBetDepositAuthorization extends LocalKemerBetDepositAuthorization {
  begin(
    internalPlayerId: number,
    isFresh: () => boolean,
  ): Promise<LocalKemerBetDepositDispatchOutcome>;
  clear(): void;
}

export interface LocalKemerBetFinalAction {
  isFresh(): boolean;
}

type UnknownRecord = Record<string, unknown>;

export class LocalKemerBetDepositError extends Error {
  constructor() {
    super('The local KemerBet exact deposit could not be safely completed.');
    this.name = 'LocalKemerBetDepositError';
  }
}

function unavailable(): never {
  throw new LocalKemerBetDepositError();
}

function plainRecord(candidate: unknown): candidate is UnknownRecord {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    !Array.isArray(candidate) &&
    !isProxy(candidate) &&
    Object.getPrototypeOf(candidate) === Object.prototype
  );
}

function exactDataKeys(candidate: UnknownRecord, keys: readonly string[]): boolean {
  const actual = Reflect.ownKeys(candidate);
  return (
    actual.length === keys.length &&
    actual.every((key) => typeof key === 'string' && keys.includes(key)) &&
    keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
    })
  );
}

export function createLocalKemerBetDepositAuthorization(): MutableLocalKemerBetDepositAuthorization {
  let pending: PendingDeposit | undefined;
  return Object.freeze({
    begin(internalPlayerId: number, isFresh: () => boolean) {
      if (
        pending !== undefined ||
        !Number.isSafeInteger(internalPlayerId) ||
        internalPlayerId <= 0 ||
        typeof isFresh !== 'function'
      ) {
        return Promise.reject(new LocalKemerBetDepositError());
      }
      return new Promise<LocalKemerBetDepositDispatchOutcome>((resolve) => {
        pending = Object.freeze({ internalPlayerId, isFresh, settle: resolve });
      });
    },
    consumeExactRequest(method: string, rawUrl: string, postData: unknown) {
      // Consume before validation and before the route callback's first await. A malformed request
      // can burn an allowance, but no request can retain or reuse it.
      const selected = pending;
      pending = undefined;
      let fresh = false;
      try {
        fresh = selected?.isFresh() === true;
      } catch {
        fresh = false;
      }
      if (
        selected === undefined ||
        method !== 'POST' ||
        rawUrl !== DEPOSIT_URL ||
        !plainRecord(postData) ||
        !exactDataKeys(postData, ['playerId', 'amount', 'notes']) ||
        postData.playerId !== selected.internalPlayerId ||
        postData.amount !== 25 ||
        postData.notes !== '' ||
        !fresh
      ) {
        selected?.settle({ outcome: 'local_uncertain', providerResponseDigest: null });
        return undefined;
      }
      const consumed: ConsumedLocalKemerBetDepositAuthorization = Object.freeze({
        isFresh: selected.isFresh,
        settle: selected.settle,
      });
      return consumed;
    },
    clear() {
      const selected = pending;
      pending = undefined;
      selected?.settle({ outcome: 'local_uncertain', providerResponseDigest: null });
    },
  });
}

async function exactlyOneVisible(locator: Locator): Promise<Locator | undefined> {
  const count = await locator.count();
  if (count > 20) unavailable();
  let selected: Locator | undefined;
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (!(await candidate.isVisible())) continue;
    if (selected !== undefined) unavailable();
    selected = candidate;
  }
  return selected;
}

async function requireEnabled(locator: Locator): Promise<Locator> {
  const selected = await exactlyOneVisible(locator);
  if (!selected || !(await selected.isEnabled())) unavailable();
  return selected;
}

async function anyVisible(page: Page, selector: string): Promise<boolean> {
  return (await exactlyOneVisible(page.locator(selector))) !== undefined;
}

async function requireAuthenticatedAgentPage(page: Page): Promise<void> {
  let current: URL;
  let expected: URL;
  try {
    current = new URL(page.url());
    expected = new URL(KEMERBET_AGENT_AUTHENTICATED_CANDIDATE_URL);
  } catch {
    return unavailable();
  }
  if (
    current.origin !== expected.origin ||
    (current.pathname !== expected.pathname && current.pathname !== `${expected.pathname}/`) ||
    current.search !== '' ||
    current.hash !== '' ||
    current.username !== '' ||
    current.password !== '' ||
    (await anyVisible(page, KEMERBET_LOCAL_SESSION_FAILURE_CAPTCHA_SELECTOR)) ||
    (await anyVisible(page, KEMERBET_LOCAL_SESSION_FAILURE_SIGN_IN_FORM_SELECTOR))
  ) {
    unavailable();
  }
}

async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {
      // Retry only DOM observation; no provider request occurs in this helper.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  unavailable();
}

function modalButton(page: Page, name: string): Locator {
  return page.locator('.ant-modal-content').getByRole('button', { name, exact: true });
}

async function searchSurfaceReady(page: Page): Promise<boolean> {
  const [findBy, input, find] = await Promise.all([
    exactlyOneVisible(page.locator(selectors.findBySelectedValue)),
    exactlyOneVisible(page.locator(selectors.playerIdInput)),
    exactlyOneVisible(modalButton(page, 'Find')),
  ]);
  if (!findBy && !input && !find) return false;
  if (!findBy || !input || !find) unavailable();
  if ((await findBy.innerText()).replace(/\s+/gu, ' ').trim() !== 'Player ID') unavailable();
  return true;
}

async function requireSearchOnlySurface(page: Page): Promise<void> {
  await requireAuthenticatedAgentPage(page);
  if (!(await searchSurfaceReady(page))) unavailable();
  const counts = await Promise.all([
    page.locator(selectors.lookupRoot).count(),
    page.locator(selectors.amountInput).count(),
    page.locator(selectors.notesInput).count(),
    modalButton(page, 'Transfer').count(),
  ]);
  if (counts.some((count) => count !== 0)) unavailable();
}

async function openSearchSurface(page: Page): Promise<void> {
  await requireAuthenticatedAgentPage(page);
  if (await searchSurfaceReady(page)) {
    await requireSearchOnlySurface(page);
    return;
  }
  await (
    await requireEnabled(page.locator(selectors.financialActionsTrigger))
  ).click({
    timeout: TIMEOUT_MS,
  });
  await requireAuthenticatedAgentPage(page);
  await (
    await requireEnabled(page.getByRole('menuitem', { name: 'Deposit', exact: true }))
  ).click({ timeout: TIMEOUT_MS });
  await requireAuthenticatedAgentPage(page);
  await (await requireEnabled(page.locator(selectors.toPlayerTile))).click({ timeout: TIMEOUT_MS });
  await waitUntil(async () => {
    await requireAuthenticatedAgentPage(page);
    return searchSurfaceReady(page);
  });
  await requireSearchOnlySurface(page);
}

function exactLookupResponse(response: Response, playerId: string): boolean {
  try {
    const url = new URL(response.url());
    const request = response.request();
    const query = [...url.searchParams.entries()];
    return (
      url.origin === KEMERBET_AGENT_API_ORIGIN &&
      url.pathname === KEMERBET_AGENT_PLAYER_LOOKUP_PATH &&
      url.port === '' &&
      url.hash === '' &&
      query.length === 1 &&
      query[0]?.[0] === 'externalId' &&
      query[0]?.[1] === playerId &&
      request.method() === 'GET' &&
      request.redirectedFrom() === null &&
      request.redirectedTo() === null
    );
  } catch {
    return false;
  }
}

function privateInternalPlayer(
  body: Buffer,
  requestedPlayerId: string,
): {
  readonly internalPlayerId: number;
  readonly identities: readonly string[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown;
  } catch {
    return unavailable();
  }
  if (!plainRecord(parsed) || !plainRecord(parsed.value)) unavailable();
  const value = parsed.value;
  if (
    !Number.isSafeInteger(value.id) ||
    (value.id as number) <= 0 ||
    value.externalId !== requestedPlayerId ||
    value.currencyCode !== 'ETB'
  ) {
    unavailable();
  }
  const identities = [...new Set([value.userName, value.email])].filter(
    (candidate): candidate is string =>
      typeof candidate === 'string' &&
      candidate.length > 0 &&
      candidate === candidate.trim() &&
      Buffer.byteLength(candidate, 'utf8') <= 256 &&
      !/[\u0000-\u001f\u007f]/u.test(candidate),
  );
  if (identities.length < 1 || identities.length > 2) unavailable();
  return Object.freeze({ internalPlayerId: value.id as number, identities });
}

async function verifyPreparedSurface(page: Page, identities: readonly string[]): Promise<Locator> {
  await requireAuthenticatedAgentPage(page);
  const root = await exactlyOneVisible(page.locator(selectors.lookupRoot));
  const amount = await requireEnabled(page.locator(selectors.amountInput));
  const notes = await requireEnabled(page.locator(selectors.notesInput));
  const transfer = await requireEnabled(modalButton(page, 'Transfer'));
  if (!root) unavailable();
  const identity = await exactlyOneVisible(root.locator(selectors.resolvedIdentity));
  const currency = await exactlyOneVisible(root.locator(selectors.currencyCode));
  if (
    !identity ||
    !currency ||
    !identities.includes((await identity.innerText()).trim()) ||
    (await currency.innerText()).trim() !== 'ETB' ||
    (await amount.inputValue()) !== EXACT_AMOUNT_TEXT ||
    (await notes.inputValue()) !== ''
  ) {
    unavailable();
  }
  return transfer;
}

/**
 * Prepares the exact Player and amount before requesting final authority, then performs at most
 * one guarded click. The internal numeric Player key remains in this closure and is never logged.
 */
export async function executeExactOneUseLocalKemerBetDeposit(
  page: Page,
  playerId: string,
  lookupAuthorization: MutableLocalKemerBetLookupAuthorization,
  depositAuthorization: MutableLocalKemerBetDepositAuthorization,
  acquireFinalAction: () => Promise<LocalKemerBetFinalAction>,
): Promise<LocalKemerBetDepositDispatchOutcome> {
  if (!PLAYER_ID_PATTERN.test(playerId)) unavailable();
  await openSearchSurface(page);
  const input = await requireEnabled(page.locator(selectors.playerIdInput));
  await input.fill('', { timeout: TIMEOUT_MS });
  await input.pressSequentially(playerId, { delay: 10, timeout: TIMEOUT_MS });
  if ((await input.inputValue()) !== playerId) unavailable();
  await input.blur({ timeout: TIMEOUT_MS });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  await requireSearchOnlySurface(page);
  const find = await requireEnabled(modalButton(page, 'Find'));
  await find.click({ trial: true, timeout: TIMEOUT_MS });

  await requireSearchOnlySurface(page);
  const finalInput = await requireEnabled(page.locator(selectors.playerIdInput));
  if ((await finalInput.inputValue()) !== playerId) unavailable();
  const exactFind = await requireEnabled(modalButton(page, 'Find'));

  let responsePromise: Promise<Response> | undefined;
  let body: Buffer | undefined;
  let privatePlayer:
    { readonly internalPlayerId: number; readonly identities: readonly string[] } | undefined;
  lookupAuthorization.begin(playerId);
  try {
    responsePromise = page.waitForResponse((response) => exactLookupResponse(response, playerId), {
      timeout: TIMEOUT_MS,
    });
    await exactFind.click({ timeout: TIMEOUT_MS });
    const response = await responsePromise;
    body = await response.body();
    if (
      !validateKemerBetReadOnlyPlayerLookupResponse({
        body,
        requestedPlayerId: playerId,
        statusCode: response.status(),
      })
    ) {
      unavailable();
    }
    privatePlayer = privateInternalPlayer(body, playerId);
  } catch {
    void responsePromise?.catch(() => undefined);
    unavailable();
  } finally {
    body?.fill(0);
    lookupAuthorization.clear();
  }
  if (!privatePlayer) unavailable();

  const amount = await requireEnabled(page.locator(selectors.amountInput));
  const notes = await requireEnabled(page.locator(selectors.notesInput));
  if ((await amount.inputValue()) !== '' || (await notes.inputValue()) !== '') unavailable();
  await amount.fill(EXACT_AMOUNT_TEXT, { timeout: TIMEOUT_MS });
  await notes.fill('', { timeout: TIMEOUT_MS });
  const trialTransfer = await verifyPreparedSurface(page, privatePlayer.identities);
  await trialTransfer.click({ trial: true, timeout: TIMEOUT_MS });

  // The server/database fence is intentionally requested only after the page is fully prepared.
  const finalAction = await acquireFinalAction();
  const transfer = await verifyPreparedSurface(page, privatePlayer.identities);
  if (finalAction.isFresh() !== true) unavailable();
  const routeOutcome = depositAuthorization.begin(
    privatePlayer.internalPlayerId,
    finalAction.isFresh,
  );
  let routeTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await transfer.click({ timeout: TIMEOUT_MS });
    return await Promise.race([
      routeOutcome,
      new Promise<LocalKemerBetDepositDispatchOutcome>((resolve) => {
        routeTimeout = setTimeout(() => {
          depositAuthorization.clear();
          resolve({ outcome: 'local_uncertain', providerResponseDigest: null });
        }, TIMEOUT_MS);
        routeTimeout.unref();
      }),
    ]);
  } catch {
    depositAuthorization.clear();
    await routeOutcome.catch(() => undefined);
    return Object.freeze({ outcome: 'local_uncertain', providerResponseDigest: null });
  } finally {
    if (routeTimeout !== undefined) clearTimeout(routeTimeout);
  }
}
