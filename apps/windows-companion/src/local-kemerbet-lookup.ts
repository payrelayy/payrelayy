import {
  KEMERBET_AGENT_API_ORIGIN,
  KEMERBET_AGENT_AUTHENTICATED_CANDIDATE_URL,
  KEMERBET_AGENT_PLAYER_LOOKUP_PATH,
  KEMERBET_LOCAL_SESSION_FAILURE_CAPTCHA_SELECTOR,
  KEMERBET_LOCAL_SESSION_FAILURE_SIGN_IN_FORM_SELECTOR,
  validateKemerBetReadOnlyPlayerLookupResponse,
} from '@fetanagent/agent-platform-kemerbet';
import type { ExactFivePlayerIds } from '@fetanagent/agent-platform-companion-contracts';
import type { Locator, Page, Response } from 'playwright-core';

import type { LocalKemerBetLookupAuthorization } from './provider-route.js';

const PLAYER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const LOOKUP_TIMEOUT_MS = 30_000;

const selectors = Object.freeze({
  financialActionsTrigger: '.rt--header-right .rt--header-actions-content-icon:has(.icon-transfer)',
  toPlayerTile: '.rt--transfer-item:has(.icon-player)',
  findBySelectedValue: '.ant-modal-content .ant-select-selection-item',
  playerIdInput: '.ant-modal-content [data-placeholder="Enter Player ID"] input',
  lookupRoot: '.ant-modal-content .rt--transfer-player-info',
  resolvedIdentity: '.rt--transfer-player-info-details > .rt--flex:nth-child(1) > b',
  currencyCode: '.rt--transfer-player-info-details > .rt--flex:nth-child(2) > b',
  preparedDeposit: '.ant-modal-content:has(.rt--transfer-player-info)',
  amountInput: '.ant-modal-content [data-placeholder="Enter Amount"] input',
  notesInput: '.ant-modal-content [data-placeholder="Enter Notes"] textarea',
} as const);

export type LocalKemerBetLookupOutcome = 'found' | 'review_required';

export interface MutableLocalKemerBetLookupAuthorization extends LocalKemerBetLookupAuthorization {
  begin(playerId: string): void;
  clear(): void;
}

export class LocalKemerBetLookupError extends Error {
  constructor() {
    super('The local KemerBet read-only lookup could not be verified.');
    this.name = 'LocalKemerBetLookupError';
  }
}

function unavailable(): never {
  throw new LocalKemerBetLookupError();
}

export function createLocalKemerBetLookupAuthorization(): MutableLocalKemerBetLookupAuthorization {
  let activePlayerId: string | undefined;
  let consumed = false;
  return Object.freeze({
    begin(playerId: string) {
      if (activePlayerId !== undefined || !PLAYER_ID_PATTERN.test(playerId)) unavailable();
      activePlayerId = playerId;
      consumed = false;
    },
    currentPlayerId() {
      return consumed ? undefined : activePlayerId;
    },
    consume(playerId: string) {
      if (consumed || activePlayerId === undefined || playerId !== activePlayerId) return false;
      consumed = true;
      return true;
    },
    clear() {
      activePlayerId = undefined;
      consumed = false;
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

async function waitForEnabledAuthenticatedControl(page: Page, locator: Locator): Promise<Locator> {
  await waitUntil(async () => {
    await requireAuthenticatedAgentPage(page);
    const selected = await exactlyOneVisible(locator);
    return selected !== undefined && (await selected.isEnabled());
  });
  await requireAuthenticatedAgentPage(page);
  return requireEnabled(locator);
}

async function anyVisible(page: Page, selector: string): Promise<boolean> {
  return (await exactlyOneVisible(page.locator(selector))) !== undefined;
}

async function requireAuthenticatedAgentPage(page: Page): Promise<void> {
  let currentUrl: URL;
  let expectedUrl: URL;
  try {
    currentUrl = new URL(page.url());
    expectedUrl = new URL(KEMERBET_AGENT_AUTHENTICATED_CANDIDATE_URL);
  } catch {
    unavailable();
  }
  if (
    currentUrl.origin !== expectedUrl.origin ||
    (currentUrl.pathname !== expectedUrl.pathname &&
      currentUrl.pathname !== `${expectedUrl.pathname}/`) ||
    currentUrl.search !== '' ||
    currentUrl.hash !== '' ||
    currentUrl.username !== '' ||
    currentUrl.password !== ''
  ) {
    unavailable();
  }
  if (
    (await anyVisible(page, KEMERBET_LOCAL_SESSION_FAILURE_CAPTCHA_SELECTOR)) ||
    (await anyVisible(page, KEMERBET_LOCAL_SESSION_FAILURE_SIGN_IN_FORM_SELECTOR))
  ) {
    unavailable();
  }
}

async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + LOOKUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    let ready = false;
    try {
      ready = await check();
    } catch {
      ready = false;
    }
    if (ready) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  unavailable();
}

function modalRole(page: Page, role: 'button', name: string): Locator {
  return page.locator('.ant-modal-content').getByRole(role, { name, exact: true });
}

async function searchSurfaceReady(page: Page): Promise<boolean> {
  const [findBy, playerIdInput, findButton] = await Promise.all([
    exactlyOneVisible(page.locator(selectors.findBySelectedValue)),
    exactlyOneVisible(page.locator(selectors.playerIdInput)),
    exactlyOneVisible(modalRole(page, 'button', 'Find')),
  ]);
  if (!findBy && !playerIdInput && !findButton) return false;
  if (!findBy || !playerIdInput || !findButton) unavailable();
  if ((await findBy.innerText()).replace(/\s+/gu, ' ').trim() !== 'Player ID') unavailable();
  return true;
}

async function requireSearchOnlySurface(page: Page): Promise<void> {
  await requireAuthenticatedAgentPage(page);
  if (!(await searchSurfaceReady(page))) unavailable();
  const counts = await Promise.all([
    page.locator(selectors.lookupRoot).count(),
    page.locator(selectors.preparedDeposit).count(),
    page.locator(selectors.amountInput).count(),
    page.locator(selectors.notesInput).count(),
    modalRole(page, 'button', 'Transfer').count(),
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
    timeout: LOOKUP_TIMEOUT_MS,
  });
  await requireAuthenticatedAgentPage(page);
  await (
    await waitForEnabledAuthenticatedControl(
      page,
      page.getByRole('menuitem', { name: 'Deposit', exact: true }),
    )
  ).click({
    timeout: LOOKUP_TIMEOUT_MS,
  });
  await requireAuthenticatedAgentPage(page);
  await (
    await waitForEnabledAuthenticatedControl(page, page.locator(selectors.toPlayerTile))
  ).click({
    timeout: LOOKUP_TIMEOUT_MS,
  });
  await waitUntil(async () => {
    await requireAuthenticatedAgentPage(page);
    return searchSurfaceReady(page);
  });
  await requireSearchOnlySurface(page);
}

function exactLookupResponse(response: Response, playerId: string): boolean {
  let url: URL;
  try {
    url = new URL(response.url());
  } catch {
    return false;
  }
  const request = response.request();
  const query = [...url.searchParams.entries()];
  return (
    url.origin === KEMERBET_AGENT_API_ORIGIN &&
    url.pathname === KEMERBET_AGENT_PLAYER_LOOKUP_PATH &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    url.hash === '' &&
    query.length === 1 &&
    query[0]?.[0] === 'externalId' &&
    query[0]?.[1] === playerId &&
    request.method() === 'GET' &&
    request.redirectedFrom() === null &&
    request.redirectedTo() === null
  );
}

async function verifyRenderedResultAndReset(page: Page): Promise<void> {
  await waitUntil(
    async () => (await exactlyOneVisible(page.locator(selectors.lookupRoot))) !== undefined,
  );
  const lookupRoot = await exactlyOneVisible(page.locator(selectors.lookupRoot));
  const prepared = await exactlyOneVisible(page.locator(selectors.preparedDeposit));
  const amount = await exactlyOneVisible(page.locator(selectors.amountInput));
  const notes = await exactlyOneVisible(page.locator(selectors.notesInput));
  const transfer = await exactlyOneVisible(modalRole(page, 'button', 'Transfer'));
  if (!lookupRoot || !prepared || !amount || !notes || !transfer) unavailable();
  const identity = await exactlyOneVisible(lookupRoot.locator(selectors.resolvedIdentity));
  const currency = await exactlyOneVisible(lookupRoot.locator(selectors.currencyCode));
  if (
    !identity ||
    !currency ||
    (await identity.innerText()).trim().length < 1 ||
    (await currency.innerText()).trim() !== 'ETB' ||
    (await amount.inputValue()) !== '' ||
    (await notes.inputValue()) !== ''
  ) {
    unavailable();
  }
  const reset = await lookupRoot.evaluate((element) => {
    if (!element.isConnected) return false;
    const view = element.ownerDocument.defaultView;
    if (!view) return false;
    return element.ownerDocument.dispatchEvent(
      new view.CustomEvent('onTransferEposPlayerFoundEvent', { detail: { info: null } }),
    );
  });
  if (reset !== true) unavailable();
  await waitUntil(async () => {
    try {
      await requireSearchOnlySurface(page);
      return true;
    } catch {
      return false;
    }
  });
}

async function lookupOne(
  page: Page,
  playerId: string,
  authorization: MutableLocalKemerBetLookupAuthorization,
): Promise<void> {
  await requireSearchOnlySurface(page);
  const input = await requireEnabled(page.locator(selectors.playerIdInput));
  await input.fill('', { timeout: LOOKUP_TIMEOUT_MS });
  await input.pressSequentially(playerId, { delay: 10, timeout: LOOKUP_TIMEOUT_MS });
  if ((await input.inputValue()) !== playerId) unavailable();
  await input.blur({ timeout: LOOKUP_TIMEOUT_MS });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  await requireSearchOnlySurface(page);
  const find = await requireEnabled(modalRole(page, 'button', 'Find'));
  await find.click({ trial: true, timeout: LOOKUP_TIMEOUT_MS });
  await requireSearchOnlySurface(page);
  if (
    (await (await requireEnabled(page.locator(selectors.playerIdInput))).inputValue()) !== playerId
  ) {
    unavailable();
  }
  const exactFind = await requireEnabled(modalRole(page, 'button', 'Find'));
  authorization.begin(playerId);
  let responsePromise: Promise<Response> | undefined;
  try {
    responsePromise = page.waitForResponse((response) => exactLookupResponse(response, playerId), {
      timeout: LOOKUP_TIMEOUT_MS,
    });
    await exactFind.click({ timeout: LOOKUP_TIMEOUT_MS });
    const response = await responsePromise;
    let body: Buffer | undefined;
    try {
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
    } finally {
      body?.fill(0);
    }
  } catch {
    void responsePromise?.catch(() => undefined);
    unavailable();
  } finally {
    authorization.clear();
  }
  await verifyRenderedResultAndReset(page);
}

/** Execute only the exact five server-assigned GET lookups; no amount or final action is exposed. */
export async function executeExactFiveLocalKemerBetLookup(
  page: Page,
  playerIds: ExactFivePlayerIds,
  authorization: MutableLocalKemerBetLookupAuthorization,
): Promise<
  readonly [
    LocalKemerBetLookupOutcome,
    LocalKemerBetLookupOutcome,
    LocalKemerBetLookupOutcome,
    LocalKemerBetLookupOutcome,
    LocalKemerBetLookupOutcome,
  ]
> {
  if (
    new Set(playerIds).size !== 5 ||
    playerIds.some((playerId) => !PLAYER_ID_PATTERN.test(playerId))
  ) {
    unavailable();
  }
  await openSearchSurface(page);
  const outcomes: LocalKemerBetLookupOutcome[] = [];
  for (let index = 0; index < playerIds.length; index += 1) {
    try {
      await lookupOne(page, playerIds[index]!, authorization);
      outcomes.push('found');
    } catch {
      authorization.clear();
      outcomes.push('review_required');
      while (outcomes.length < 5) outcomes.push('review_required');
      break;
    }
  }
  return Object.freeze(outcomes) as readonly [
    LocalKemerBetLookupOutcome,
    LocalKemerBetLookupOutcome,
    LocalKemerBetLookupOutcome,
    LocalKemerBetLookupOutcome,
    LocalKemerBetLookupOutcome,
  ];
}
