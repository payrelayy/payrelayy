import type { Page } from 'playwright-core';

import {
  KemerBetDepositBrowserUnavailableError,
  type BrowserRole,
  type KemerBetAgentHistoryView,
  type KemerBetAgentLookupView,
  type KemerBetAgentPreparedDepositView,
  type KemerBetAgentTransferResultView,
  type KemerBetBrowserPage,
} from './kemerbet-deposit-browser-adapter.js';
import type { KemerBetAgentIdentityFingerprinter } from './kemerbet-agent-identity-fingerprint.js';

export const KEMERBET_AGENT_DEPOSIT_URL =
  'https://agentsystem.admindigi.com/payments/requests#tab=1' as const;
export const KEMERBET_AGENT_HISTORY_URL =
  'https://agentsystem.admindigi.com/payments/history' as const;
export const KEMERBET_AGENT_TIME_ZONE = 'Africa/Addis_Ababa' as const;

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_HISTORY_PAGES = 8;
const DEFAULT_MAX_HISTORY_ROWS = 400;
const MAX_STRUCTURED_TEXT_LENGTH = 256;

type AllowedAgentUrl = typeof KEMERBET_AGENT_DEPOSIT_URL | typeof KEMERBET_AGENT_HISTORY_URL;
type FieldSource = 'input' | 'text';

export interface KemerBetAgentStructuredFieldSelector {
  readonly selector: string;
  readonly source: FieldSource;
}

/**
 * Versioned, operator-reviewed selectors for facts that have no stable accessible-name contract.
 * A layout change is expected to make this contract fail closed; callers must not use broad body
 * text or guessed fallback selectors.
 */
export interface KemerBetAgentPageSelectorContractV1 {
  readonly version: 1;
  readonly signedInAgentIdentity: {
    readonly root: string;
    readonly value: KemerBetAgentStructuredFieldSelector;
  };
  readonly lookup: {
    readonly root: string;
    readonly playerId: KemerBetAgentStructuredFieldSelector;
    readonly currencyCode: KemerBetAgentStructuredFieldSelector;
  };
  readonly preparedDeposit: {
    readonly root: string;
    readonly playerId: KemerBetAgentStructuredFieldSelector;
    readonly amount: KemerBetAgentStructuredFieldSelector;
    readonly currencyCode: KemerBetAgentStructuredFieldSelector;
  };
  readonly transferResult: {
    readonly dialog: string;
    readonly title: KemerBetAgentStructuredFieldSelector;
    readonly playerCreditFact: KemerBetAgentStructuredFieldSelector;
  };
  readonly history: {
    readonly table: string;
    readonly headerCells: string;
    readonly bodyRows: string;
    readonly rowCells: string;
    readonly nextButton: string;
    readonly columns: {
      readonly stateLabel: string;
      readonly operationLabel: string;
      readonly paymentMethod: string;
      readonly playerId: string;
      readonly amount: string;
      readonly currencyCode: string;
      readonly occurredAt: string;
      readonly externalReference: string;
    };
  };
  readonly sessionFailure: {
    readonly captcha: string;
    readonly signInForm: string;
  };
}

export interface PlaywrightLocatorPort {
  locator(selector: string): PlaywrightLocatorPort;
  nth(index: number): PlaywrightLocatorPort;
  count(): Promise<number>;
  click(options?: { readonly timeout?: number }): Promise<unknown>;
  fill(value: string, options?: { readonly timeout?: number }): Promise<unknown>;
  selectOption(value: string, options?: { readonly timeout?: number }): Promise<readonly string[]>;
  inputValue(options?: { readonly timeout?: number }): Promise<string>;
  innerText(options?: { readonly timeout?: number }): Promise<string>;
  isVisible(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  getAttribute(name: string): Promise<string | null>;
}

export interface PlaywrightPagePort {
  goto(
    url: string,
    options: { readonly waitUntil: 'domcontentloaded'; readonly timeout: number },
  ): Promise<unknown>;
  url(): string;
  getByRole(
    role: BrowserRole,
    options: { readonly name: string; readonly exact: true },
  ): PlaywrightLocatorPort;
  getByLabel(text: string, options: { readonly exact: true }): PlaywrightLocatorPort;
  locator(selector: string): PlaywrightLocatorPort;
}

export interface PlaywrightKemerBetAgentPageOptions {
  readonly page: Page | PlaywrightPagePort;
  readonly platformAgentAccountId: string;
  readonly sessionKey: string;
  readonly selectorContract: KemerBetAgentPageSelectorContractV1;
  readonly expectedAgentIdentityFingerprint: string;
  readonly fingerprintAgentIdentity: KemerBetAgentIdentityFingerprinter;
  readonly timeoutMs?: number;
  readonly maxHistoryPages?: number;
  readonly maxHistoryRows?: number;
  readonly agentTimeZone?: string;
  readonly pollDelay?: (milliseconds: number) => Promise<void>;
  readonly monotonicNow?: () => number;
}

export interface PlaywrightKemerBetAgentPage extends KemerBetBrowserPage {
  /** Side-effect-free authenticated UI probe; it only navigates to agent history and reads identity. */
  probeAuthenticatedSession(): Promise<void>;
}

function unavailable(): never {
  throw new KemerBetDepositBrowserUnavailableError();
}

function requireBoundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) unavailable();
  return value;
}

function requireNonemptyBounded(value: string, maximum = MAX_STRUCTURED_TEXT_LENGTH): string {
  if (value.length < 1 || value.length > maximum || value !== value.trim()) unavailable();
  return value;
}

function requireSelector(value: string): void {
  requireNonemptyBounded(value, 512);
  if (/\r|\n|\0/u.test(value)) unavailable();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isStructuredField(value: unknown): value is KemerBetAgentStructuredFieldSelector {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['selector', 'source']) &&
    typeof value.selector === 'string' &&
    (value.source === 'input' || value.source === 'text')
  );
}

/** Validate an untrusted selector-contract file before any browser or lease can be opened. */
export function assertKemerBetAgentPageSelectorContractV1(
  value: unknown,
): asserts value is KemerBetAgentPageSelectorContractV1 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'version',
      'signedInAgentIdentity',
      'lookup',
      'preparedDeposit',
      'transferResult',
      'history',
      'sessionFailure',
    ]) ||
    value.version !== 1
  ) {
    unavailable();
  }
  const lookup = value.lookup;
  const signedInAgentIdentity = value.signedInAgentIdentity;
  const preparedDeposit = value.preparedDeposit;
  const transferResult = value.transferResult;
  const history = value.history;
  const sessionFailure = value.sessionFailure;
  if (
    !isRecord(signedInAgentIdentity) ||
    !hasExactKeys(signedInAgentIdentity, ['root', 'value']) ||
    typeof signedInAgentIdentity.root !== 'string' ||
    !isStructuredField(signedInAgentIdentity.value) ||
    !isRecord(lookup) ||
    !hasExactKeys(lookup, ['root', 'playerId', 'currencyCode']) ||
    typeof lookup.root !== 'string' ||
    !isStructuredField(lookup.playerId) ||
    !isStructuredField(lookup.currencyCode) ||
    !isRecord(preparedDeposit) ||
    !hasExactKeys(preparedDeposit, ['root', 'playerId', 'amount', 'currencyCode']) ||
    typeof preparedDeposit.root !== 'string' ||
    !isStructuredField(preparedDeposit.playerId) ||
    !isStructuredField(preparedDeposit.amount) ||
    !isStructuredField(preparedDeposit.currencyCode) ||
    !isRecord(transferResult) ||
    !hasExactKeys(transferResult, ['dialog', 'title', 'playerCreditFact']) ||
    typeof transferResult.dialog !== 'string' ||
    !isStructuredField(transferResult.title) ||
    !isStructuredField(transferResult.playerCreditFact) ||
    !isRecord(history) ||
    !hasExactKeys(history, [
      'table',
      'headerCells',
      'bodyRows',
      'rowCells',
      'nextButton',
      'columns',
    ]) ||
    typeof history.table !== 'string' ||
    typeof history.headerCells !== 'string' ||
    typeof history.bodyRows !== 'string' ||
    typeof history.rowCells !== 'string' ||
    typeof history.nextButton !== 'string' ||
    !isRecord(history.columns) ||
    !isRecord(sessionFailure) ||
    !hasExactKeys(sessionFailure, ['captcha', 'signInForm']) ||
    typeof sessionFailure.captcha !== 'string' ||
    typeof sessionFailure.signInForm !== 'string'
  ) {
    unavailable();
  }
  const historyColumns = history.columns;
  const columnKeys = [
    'stateLabel',
    'operationLabel',
    'paymentMethod',
    'playerId',
    'amount',
    'currencyCode',
    'occurredAt',
    'externalReference',
  ] as const;
  if (!hasExactKeys(historyColumns, columnKeys)) unavailable();
  if (columnKeys.some((key) => typeof historyColumns[key] !== 'string')) unavailable();
  const contract = value as unknown as KemerBetAgentPageSelectorContractV1;
  const fields = [
    contract.signedInAgentIdentity.value,
    contract.lookup.playerId,
    contract.lookup.currencyCode,
    contract.preparedDeposit.playerId,
    contract.preparedDeposit.amount,
    contract.preparedDeposit.currencyCode,
    contract.transferResult.title,
    contract.transferResult.playerCreditFact,
  ];
  for (const selector of [
    contract.signedInAgentIdentity.root,
    contract.lookup.root,
    contract.preparedDeposit.root,
    contract.transferResult.dialog,
    contract.history.table,
    contract.history.headerCells,
    contract.history.bodyRows,
    contract.history.rowCells,
    contract.history.nextButton,
    contract.sessionFailure.captcha,
    contract.sessionFailure.signInForm,
  ]) {
    requireSelector(selector);
  }
  for (const field of fields) {
    requireSelector(field.selector);
    if (field.source !== 'input' && field.source !== 'text') unavailable();
  }
  const columnNames = Object.values(contract.history.columns);
  if (new Set(columnNames).size !== columnNames.length) unavailable();
  for (const name of columnNames) requireNonemptyBounded(name, 80);
}

function requireAllowedAgentUrl(rawUrl: string): AllowedAgentUrl {
  let normalized: string;
  try {
    normalized = new URL(rawUrl).href;
  } catch {
    return unavailable();
  }
  if (normalized !== KEMERBET_AGENT_DEPOSIT_URL && normalized !== KEMERBET_AGENT_HISTORY_URL) {
    return unavailable();
  }
  return normalized;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function strictIsoInstant(value: string): string | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?(Z|[+-]\d{2}:\d{2})$/u.exec(
      value,
    );
  if (!match) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    return null;
  }
  return date.toISOString();
}

interface LocalTimestampParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
}

function zonedParts(
  epochMilliseconds: number,
  timeZone: string,
): Omit<LocalTimestampParts, 'millisecond'> {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      calendar: 'iso8601',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return unavailable();
  }
  const entries = new Map(
    formatter
      .formatToParts(new Date(epochMilliseconds))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  const result = {
    year: entries.get('year'),
    month: entries.get('month'),
    day: entries.get('day'),
    hour: entries.get('hour'),
    minute: entries.get('minute'),
    second: entries.get('second'),
  };
  if (Object.values(result).some((part) => part === undefined || !Number.isFinite(part))) {
    return unavailable();
  }
  return result as Omit<LocalTimestampParts, 'millisecond'>;
}

function sameLocalTimestamp(
  actual: Omit<LocalTimestampParts, 'millisecond'>,
  expected: LocalTimestampParts,
): boolean {
  return (
    actual.year === expected.year &&
    actual.month === expected.month &&
    actual.day === expected.day &&
    actual.hour === expected.hour &&
    actual.minute === expected.minute &&
    actual.second === expected.second
  );
}

/** Normalize an exact portal timestamp to the UTC shape required by reconciliation. */
export function normalizeKemerBetAgentTimestamp(
  rawValue: string,
  timeZone: string = KEMERBET_AGENT_TIME_ZONE,
): string {
  const value = requireNonemptyBounded(rawValue, 64);
  const instant = strictIsoInstant(value);
  if (instant !== null) return instant;

  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?$/u.exec(value);
  if (!match) return unavailable();
  const expected: LocalTimestampParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6]),
    millisecond: Number(match[7] ?? '0'),
  };
  const localAsUtc = Date.UTC(
    expected.year,
    expected.month - 1,
    expected.day,
    expected.hour,
    expected.minute,
    expected.second,
    expected.millisecond,
  );
  const calendarCheck = new Date(localAsUtc);
  if (
    calendarCheck.getUTCFullYear() !== expected.year ||
    calendarCheck.getUTCMonth() !== expected.month - 1 ||
    calendarCheck.getUTCDate() !== expected.day ||
    calendarCheck.getUTCHours() !== expected.hour ||
    calendarCheck.getUTCMinutes() !== expected.minute ||
    calendarCheck.getUTCSeconds() !== expected.second
  ) {
    return unavailable();
  }

  let candidate = localAsUtc;
  for (let index = 0; index < 3; index += 1) {
    const rendered = zonedParts(candidate, timeZone);
    const renderedAsUtc = Date.UTC(
      rendered.year,
      rendered.month - 1,
      rendered.day,
      rendered.hour,
      rendered.minute,
      rendered.second,
      expected.millisecond,
    );
    candidate -= renderedAsUtc - localAsUtc;
  }
  if (!sameLocalTimestamp(zonedParts(candidate, timeZone), expected)) return unavailable();
  return new Date(candidate).toISOString();
}

async function defaultPollDelay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function observeStrictLocator(
  root: Pick<PlaywrightPagePort, 'locator'> | PlaywrightLocatorPort,
  selector: string,
): Promise<PlaywrightLocatorPort | null> {
  const locator = root.locator(selector);
  const count = await locator.count();
  if (count === 0) return null;
  if (count !== 1) unavailable();
  if (!(await locator.isVisible())) return null;
  return locator;
}

async function observeStructuredField(
  root: PlaywrightLocatorPort,
  field: KemerBetAgentStructuredFieldSelector,
  maximum = MAX_STRUCTURED_TEXT_LENGTH,
  normalizeText = true,
): Promise<string | null> {
  const locator = await observeStrictLocator(root, field.selector);
  if (locator === null) return null;
  const value =
    field.source === 'input'
      ? await locator.inputValue()
      : normalizeText
        ? normalizeWhitespace(await locator.innerText())
        : await locator.innerText();
  if (value.length === 0) return null;
  return requireNonemptyBounded(value, maximum);
}

function requireExactColumnIndexes(
  headers: readonly string[],
  columns: KemerBetAgentPageSelectorContractV1['history']['columns'],
): Record<keyof typeof columns, number> {
  const result = {} as Record<keyof typeof columns, number>;
  for (const [key, expected] of Object.entries(columns) as [keyof typeof columns, string][]) {
    const matches = headers.flatMap((header, index) => (header === expected ? [index] : []));
    if (matches.length !== 1) unavailable();
    result[key] = matches[0]!;
  }
  return result;
}

function historySignature(rows: readonly KemerBetAgentHistoryView[]): string {
  return JSON.stringify(rows);
}

export function createPlaywrightKemerBetAgentPage(
  options: PlaywrightKemerBetAgentPageOptions,
): PlaywrightKemerBetAgentPage {
  assertKemerBetAgentPageSelectorContractV1(options.selectorContract);
  const page = options.page as PlaywrightPagePort;
  const platformAgentAccountId = requireNonemptyBounded(options.platformAgentAccountId, 36);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      platformAgentAccountId,
    ) ||
    platformAgentAccountId === '00000000-0000-0000-0000-000000000000'
  ) {
    unavailable();
  }
  const sessionKey = requireNonemptyBounded(options.sessionKey, 160);
  const timeoutMs = requireBoundedInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 100, 120_000);
  const maxHistoryPages = requireBoundedInteger(
    options.maxHistoryPages ?? DEFAULT_MAX_HISTORY_PAGES,
    1,
    50,
  );
  const maxHistoryRows = requireBoundedInteger(
    options.maxHistoryRows ?? DEFAULT_MAX_HISTORY_ROWS,
    1,
    2_000,
  );
  const agentTimeZone = requireNonemptyBounded(
    options.agentTimeZone ?? KEMERBET_AGENT_TIME_ZONE,
    80,
  );
  // Validate the IANA time zone at construction rather than during a financial workflow.
  zonedParts(Date.now(), agentTimeZone);
  const pollDelay = options.pollDelay ?? defaultPollDelay;
  const monotonicNow = options.monotonicNow ?? Date.now;
  const expectedAgentIdentityFingerprint = requireNonemptyBounded(
    options.expectedAgentIdentityFingerprint,
    128,
  );
  if (!/^hmac-sha256-agent-identity-v1:[0-9a-f]{64}$/u.test(expectedAgentIdentityFingerprint)) {
    unavailable();
  }
  const fingerprintAgentIdentity = options.fingerprintAgentIdentity;
  const contract = options.selectorContract;

  let expectedUrl: AllowedAgentUrl | null = null;
  let preparedPlayerId: string | null = null;

  async function anyVisible(selector: string): Promise<boolean> {
    const locator = page.locator(selector);
    const count = await locator.count();
    if (count > 20) unavailable();
    for (let index = 0; index < count; index += 1) {
      if (await locator.nth(index).isVisible()) return true;
    }
    return false;
  }

  async function requireExactRouteAndNoSessionFailure(): Promise<AllowedAgentUrl> {
    if (expectedUrl === null) unavailable();
    const current = requireAllowedAgentUrl(page.url());
    if (current !== expectedUrl) unavailable();
    if (
      (await anyVisible(contract.sessionFailure.captcha)) ||
      (await anyVisible(contract.sessionFailure.signInForm))
    ) {
      unavailable();
    }
    return current;
  }

  async function observeExactAgentIdentity(): Promise<boolean> {
    const root = await observeStrictLocator(page, contract.signedInAgentIdentity.root);
    if (root === null) return false;
    const rawIdentity = await observeStructuredField(
      root,
      contract.signedInAgentIdentity.value,
      256,
      false,
    );
    if (rawIdentity === null) return false;
    let observedFingerprint: string;
    try {
      observedFingerprint = fingerprintAgentIdentity(platformAgentAccountId, rawIdentity);
    } catch {
      return unavailable();
    }
    if (
      !/^hmac-sha256-agent-identity-v1:[0-9a-f]{64}$/u.test(observedFingerprint) ||
      observedFingerprint !== expectedAgentIdentityFingerprint
    ) {
      unavailable();
    }
    return true;
  }

  async function pollAuthenticated<T>(observe: () => Promise<T | null>): Promise<T | null> {
    const deadline = monotonicNow() + timeoutMs;
    const maximumPolls = Math.ceil(timeoutMs / 10) + 2;
    for (let poll = 0; poll < maximumPolls; poll += 1) {
      await requireExactRouteAndNoSessionFailure();
      if (await observeExactAgentIdentity()) {
        const result = await observe();
        if (result !== null) {
          await requireExactRouteAndNoSessionFailure();
          if (!(await observeExactAgentIdentity())) unavailable();
          return result;
        }
      }
      const remaining = deadline - monotonicNow();
      if (remaining <= 0) return null;
      await pollDelay(Math.min(50, Math.max(1, remaining)));
    }
    return null;
  }

  async function requireReadyAgentPage(): Promise<AllowedAgentUrl> {
    const ready = await pollAuthenticated(async () => expectedUrl);
    if (ready === null) unavailable();
    return ready;
  }

  async function waitStrictLocator(
    root: Pick<PlaywrightPagePort, 'locator'> | PlaywrightLocatorPort,
    selector: string,
  ): Promise<PlaywrightLocatorPort> {
    const locator = await pollAuthenticated(async () => observeStrictLocator(root, selector));
    if (locator === null) unavailable();
    return locator;
  }

  async function waitStructuredField(
    root: PlaywrightLocatorPort,
    field: KemerBetAgentStructuredFieldSelector,
    maximum = MAX_STRUCTURED_TEXT_LENGTH,
    normalizeText = true,
  ): Promise<string> {
    const result = await pollAuthenticated(async () =>
      observeStructuredField(root, field, maximum, normalizeText),
    );
    if (result === null) unavailable();
    return result;
  }

  async function exactRole(role: BrowserRole, name: string): Promise<PlaywrightLocatorPort> {
    const locator = await pollAuthenticated(async () => {
      const candidate = page.getByRole(role, { name, exact: true });
      const count = await candidate.count();
      if (count === 0) return null;
      if (count !== 1) unavailable();
      if (!(await candidate.isVisible()) || !(await candidate.isEnabled())) return null;
      return candidate;
    });
    if (locator === null) unavailable();
    return locator;
  }

  async function exactLabel(label: string): Promise<PlaywrightLocatorPort> {
    const locator = await pollAuthenticated(async () => {
      const candidate = page.getByLabel(label, { exact: true });
      const count = await candidate.count();
      if (count === 0) return null;
      if (count !== 1) unavailable();
      if (!(await candidate.isVisible()) || !(await candidate.isEnabled())) return null;
      return candidate;
    });
    if (locator === null) unavailable();
    return locator;
  }

  async function readCurrentHistoryPage(): Promise<readonly KemerBetAgentHistoryView[]> {
    const table = await waitStrictLocator(page, contract.history.table);
    const headerLocators = table.locator(contract.history.headerCells);
    const headerCount = await headerLocators.count();
    if (headerCount < 8 || headerCount > 32) unavailable();
    const headers: string[] = [];
    for (let index = 0; index < headerCount; index += 1) {
      headers.push(
        requireNonemptyBounded(
          normalizeWhitespace(await headerLocators.nth(index).innerText()),
          80,
        ),
      );
    }
    const indexes = requireExactColumnIndexes(headers, contract.history.columns);
    const rowLocators = table.locator(contract.history.bodyRows);
    const rowCount = await rowLocators.count();
    if (rowCount > maxHistoryRows) unavailable();
    const rows: KemerBetAgentHistoryView[] = [];
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const cells = rowLocators.nth(rowIndex).locator(contract.history.rowCells);
      if ((await cells.count()) !== headerCount) unavailable();
      const readRawCell = async (index: number, maximum = MAX_STRUCTURED_TEXT_LENGTH) =>
        requireNonemptyBounded(await cells.nth(index).innerText(), maximum);
      const readCell = async (index: number, maximum = MAX_STRUCTURED_TEXT_LENGTH) =>
        requireNonemptyBounded(normalizeWhitespace(await readRawCell(index, maximum)), maximum);
      // A reference is opaque input to HMAC. Never trim, collapse, or otherwise change it.
      const externalReference = await readRawCell(indexes.externalReference, 256);
      rows.push({
        stateLabel: await readRawCell(indexes.stateLabel, 80),
        operationLabel: await readRawCell(indexes.operationLabel, 80),
        paymentMethod: await readRawCell(indexes.paymentMethod, 80),
        playerId: await readRawCell(indexes.playerId, 128),
        amountText: await readRawCell(indexes.amount, 80),
        currencyCode: await readRawCell(indexes.currencyCode, 12),
        occurredAt: normalizeKemerBetAgentTimestamp(
          await readCell(indexes.occurredAt, 64),
          agentTimeZone,
        ),
        externalReference,
      });
    }
    await requireReadyAgentPage();
    return rows;
  }

  async function nextButtonState(): Promise<'disabled' | 'enabled'> {
    const next = await waitStrictLocator(page, contract.history.nextButton);
    const disabled = await next.getAttribute('disabled');
    const ariaDisabled = await next.getAttribute('aria-disabled');
    return disabled !== null || ariaDisabled === 'true' || !(await next.isEnabled())
      ? 'disabled'
      : 'enabled';
  }

  async function waitForNextHistoryPage(previousSignature: string) {
    const deadline = monotonicNow() + timeoutMs;
    const maximumPolls = Math.ceil(timeoutMs / 10) + 2;
    for (let poll = 0; poll < maximumPolls; poll += 1) {
      await requireReadyAgentPage();
      const rows = await readCurrentHistoryPage();
      if (historySignature(rows) !== previousSignature) return rows;
      const remaining = deadline - monotonicNow();
      if (remaining <= 0) break;
      await pollDelay(Math.min(50, Math.max(1, remaining)));
    }
    return unavailable();
  }

  async function navigateTo(rawUrl: string): Promise<void> {
    const target = requireAllowedAgentUrl(rawUrl);
    expectedUrl = target;
    preparedPlayerId = null;
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await requireReadyAgentPage();
  }

  return {
    sessionKey,

    async probeAuthenticatedSession() {
      await navigateTo(KEMERBET_AGENT_HISTORY_URL);
    },

    async goto(rawUrl) {
      await navigateTo(rawUrl);
    },

    async currentUrl() {
      return requireReadyAgentPage();
    },

    async clickByRole(role, name) {
      await requireReadyAgentPage();
      const allowed =
        expectedUrl === KEMERBET_AGENT_DEPOSIT_URL &&
        ((role === 'tab' && name === 'Deposit') ||
          (role === 'button' && ['To Player', 'Find', 'Transfer'].includes(name)));
      if (!allowed) unavailable();
      await (await exactRole(role, name)).click({ timeout: timeoutMs });
      await requireReadyAgentPage();
    },

    async fillByLabel(label, value) {
      await requireReadyAgentPage();
      if (
        expectedUrl !== KEMERBET_AGENT_DEPOSIT_URL ||
        !['Player ID', 'Amount', 'Notes'].includes(label) ||
        value.length > 128 ||
        /\r|\n|\0/u.test(value)
      ) {
        unavailable();
      }
      await (await exactLabel(label)).fill(value, { timeout: timeoutMs });
      await requireReadyAgentPage();
    },

    async selectByLabel(label, value) {
      await requireReadyAgentPage();
      if (
        expectedUrl !== KEMERBET_AGENT_DEPOSIT_URL ||
        label !== 'Find By' ||
        value !== 'Player ID'
      ) {
        unavailable();
      }
      const selected = await (await exactLabel(label)).selectOption(value, { timeout: timeoutMs });
      if (selected.length !== 1 || selected[0] !== value) unavailable();
      await requireReadyAgentPage();
    },

    async readAgentLookup(): Promise<KemerBetAgentLookupView> {
      await requireReadyAgentPage();
      if (expectedUrl !== KEMERBET_AGENT_DEPOSIT_URL) unavailable();
      const root = await waitStrictLocator(page, contract.lookup.root);
      const playerId = await waitStructuredField(root, contract.lookup.playerId, 128);
      const currencyCode = await waitStructuredField(root, contract.lookup.currencyCode, 12);
      if (currencyCode !== 'ETB') unavailable();
      preparedPlayerId = playerId;
      return { playerId, currencyCode };
    },

    async readAgentPreparedDeposit(): Promise<KemerBetAgentPreparedDepositView> {
      await requireReadyAgentPage();
      if (expectedUrl !== KEMERBET_AGENT_DEPOSIT_URL) unavailable();
      const root = await waitStrictLocator(page, contract.preparedDeposit.root);
      const playerId = await waitStructuredField(root, contract.preparedDeposit.playerId, 128);
      const amountText = await waitStructuredField(root, contract.preparedDeposit.amount, 80);
      const currencyCode = await waitStructuredField(
        root,
        contract.preparedDeposit.currencyCode,
        12,
      );
      if (preparedPlayerId === null || playerId !== preparedPlayerId || currencyCode !== 'ETB') {
        unavailable();
      }
      return { playerId, amountText, currencyCode };
    },

    async readAgentTransferResult(): Promise<KemerBetAgentTransferResultView | null> {
      await requireReadyAgentPage();
      const exactPreparedPlayerId = preparedPlayerId;
      if (expectedUrl !== KEMERBET_AGENT_DEPOSIT_URL || exactPreparedPlayerId === null)
        unavailable();
      return pollAuthenticated(async () => {
        const dialogs = await observeStrictLocator(page, contract.transferResult.dialog);
        if (dialogs === null) return null;
        const title = await observeStructuredField(
          dialogs,
          contract.transferResult.title,
          80,
          false,
        );
        if (title === null) return null;
        if (title !== 'Transfer Successful!') unavailable();
        const rawCreditFact = await observeStructuredField(
          dialogs,
          contract.transferResult.playerCreditFact,
          120,
          false,
        );
        if (rawCreditFact === null) return null;
        const match = /^Player Balance \+([0-9]+)\.([0-9]{2}) ETB Success$/u.exec(rawCreditFact);
        if (!match?.[1] || !match[2]) unavailable();
        return {
          playerId: exactPreparedPlayerId,
          creditEvidenceText: `Player Balance +${match[1]}.${match[2]} ETB Success`,
        };
      });
    },

    async readAgentHistory(): Promise<readonly KemerBetAgentHistoryView[]> {
      await requireReadyAgentPage();
      if (expectedUrl !== KEMERBET_AGENT_HISTORY_URL) unavailable();
      const allRows: KemerBetAgentHistoryView[] = [];
      let currentRows = await readCurrentHistoryPage();
      for (let pageIndex = 0; pageIndex < maxHistoryPages; pageIndex += 1) {
        if (allRows.length + currentRows.length > maxHistoryRows) unavailable();
        allRows.push(...currentRows);
        const state = await nextButtonState();
        if (state === 'disabled') return allRows;
        if (pageIndex === maxHistoryPages - 1) unavailable();
        const signature = historySignature(currentRows);
        const next = await waitStrictLocator(page, contract.history.nextButton);
        await next.click({ timeout: timeoutMs });
        currentRows = await waitForNextHistoryPage(signature);
      }
      return unavailable();
    },
  };
}
