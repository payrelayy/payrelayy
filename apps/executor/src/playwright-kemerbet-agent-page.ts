import type { Page } from 'playwright-core';

import {
  KemerBetDepositBrowserUnavailableError,
  type KemerBetAgentHistoryView,
  type KemerBetAgentLookupView,
  type KemerBetAgentPreparedDepositView,
  type KemerBetAgentTransferResultView,
  type KemerBetBrowserPage,
} from './kemerbet-deposit-browser-adapter.js';
import type { KemerBetAgentIdentityFingerprinter } from './kemerbet-agent-identity-fingerprint.js';

export const KEMERBET_AGENT_DEPOSIT_URL = 'https://agentsystem.admindigi.com/agents' as const;
export const KEMERBET_AGENT_HISTORY_URL =
  'https://agentsystem.admindigi.com/payments/history' as const;
export const KEMERBET_AGENT_API_ORIGIN = 'https://admin-api.agt-digi.com' as const;
export const KEMERBET_AGENT_PLAYER_LOOKUP_PATH = '/Player/GeneralInfoByExternalId' as const;
export const KEMERBET_AGENT_PLAYER_LOOKUP_URL =
  `${KEMERBET_AGENT_API_ORIGIN}${KEMERBET_AGENT_PLAYER_LOOKUP_PATH}` as const;
export const KEMERBET_AGENT_PLAYER_DEPOSIT_PATH = '/Wallet/PlayerEPOSDeposit' as const;
export const KEMERBET_AGENT_PLAYER_DEPOSIT_URL =
  `${KEMERBET_AGENT_API_ORIGIN}${KEMERBET_AGENT_PLAYER_DEPOSIT_PATH}` as const;
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

export type KemerBetAgentWorkflowControl =
  | { readonly by: 'css'; readonly selector: string }
  | { readonly by: 'label'; readonly label: string }
  | { readonly by: 'role'; readonly role: 'button' | 'menuitem'; readonly name: string }
  | { readonly by: 'text'; readonly text: string };

/**
 * Versioned, operator-reviewed selectors for facts that have no stable accessible-name contract.
 * A layout change is expected to make this contract fail closed; callers must not use broad body
 * text or guessed fallback selectors.
 */
export interface KemerBetAgentPageSelectorContractV2 {
  readonly version: 2;
  readonly depositWorkflow: {
    readonly financialActionsTrigger: KemerBetAgentWorkflowControl;
    readonly depositMenuItem: KemerBetAgentWorkflowControl;
    readonly toPlayerTile: KemerBetAgentWorkflowControl;
    readonly findBySelectedValue: KemerBetAgentWorkflowControl;
    readonly findByPlayerIdLabel: string;
    readonly playerIdInput: KemerBetAgentWorkflowControl;
    readonly findButton: KemerBetAgentWorkflowControl;
    readonly amountInput: KemerBetAgentWorkflowControl;
    readonly notesInput: KemerBetAgentWorkflowControl;
    readonly transferButton: KemerBetAgentWorkflowControl;
  };
  readonly signedInAgentIdentity: {
    readonly root: string;
    readonly value: KemerBetAgentStructuredFieldSelector;
  };
  readonly lookup: {
    readonly root: string;
    readonly resolvedIdentity: KemerBetAgentStructuredFieldSelector;
    readonly currencyCode: KemerBetAgentStructuredFieldSelector;
  };
  readonly preparedDeposit: {
    readonly root: string;
    readonly resolvedIdentity: KemerBetAgentStructuredFieldSelector;
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
  inputValue(options?: { readonly timeout?: number }): Promise<string>;
  innerText(options?: { readonly timeout?: number }): Promise<string>;
  isVisible(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  getAttribute(name: string): Promise<string | null>;
}

export interface PlaywrightRequestPort {
  method(): string;
  url(): string;
  postDataJSON(): unknown;
}

export interface PlaywrightResponsePort {
  url(): string;
  status(): number;
  request(): Pick<PlaywrightRequestPort, 'method'>;
  json(): Promise<unknown>;
}

export interface PlaywrightRoutePort {
  request(): PlaywrightRequestPort;
  continue(): Promise<unknown>;
  abort(errorCode?: string): Promise<unknown>;
}

export interface PlaywrightPagePort {
  goto(
    url: string,
    options: { readonly waitUntil: 'domcontentloaded'; readonly timeout: number },
  ): Promise<unknown>;
  url(): string;
  locator(selector: string): PlaywrightLocatorPort;
  getByLabel(label: string, options: { readonly exact: true }): PlaywrightLocatorPort;
  getByRole(
    role: 'button' | 'menuitem',
    options: { readonly name: string; readonly exact: true },
  ): PlaywrightLocatorPort;
  getByText(text: string, options: { readonly exact: true }): PlaywrightLocatorPort;
  waitForResponse(
    predicate: (response: PlaywrightResponsePort) => boolean,
    options: { readonly timeout: number },
  ): Promise<PlaywrightResponsePort>;
  route(
    url: string,
    handler: (route: PlaywrightRoutePort) => Promise<void>,
    options: { readonly times: 1 },
  ): Promise<void>;
  unroute(url: string, handler: (route: PlaywrightRoutePort) => Promise<void>): Promise<void>;
}

export interface PlaywrightKemerBetAgentPageOptions {
  readonly page: Page | PlaywrightPagePort;
  readonly platformAgentAccountId: string;
  readonly sessionKey: string;
  readonly selectorContract: KemerBetAgentPageSelectorContractV2;
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
  /** Adopt the already-authenticated Agent deposit page without navigating or reloading it. */
  adoptCurrentDepositPageWithoutNavigation(): Promise<void>;
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

function isWorkflowControl(value: unknown): value is KemerBetAgentWorkflowControl {
  if (!isRecord(value) || typeof value.by !== 'string') return false;
  if (value.by === 'css') {
    return hasExactKeys(value, ['by', 'selector']) && typeof value.selector === 'string';
  }
  if (value.by === 'label') {
    return hasExactKeys(value, ['by', 'label']) && typeof value.label === 'string';
  }
  if (value.by === 'text') {
    return hasExactKeys(value, ['by', 'text']) && typeof value.text === 'string';
  }
  return (
    value.by === 'role' &&
    hasExactKeys(value, ['by', 'role', 'name']) &&
    (value.role === 'button' || value.role === 'menuitem') &&
    typeof value.name === 'string'
  );
}

/** Validate an untrusted selector-contract file before any browser or lease can be opened. */
export function assertKemerBetAgentPageSelectorContractV2(
  value: unknown,
): asserts value is KemerBetAgentPageSelectorContractV2 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'version',
      'depositWorkflow',
      'signedInAgentIdentity',
      'lookup',
      'preparedDeposit',
      'transferResult',
      'history',
      'sessionFailure',
    ]) ||
    value.version !== 2
  ) {
    unavailable();
  }
  const lookup = value.lookup;
  const depositWorkflow = value.depositWorkflow;
  const signedInAgentIdentity = value.signedInAgentIdentity;
  const preparedDeposit = value.preparedDeposit;
  const transferResult = value.transferResult;
  const history = value.history;
  const sessionFailure = value.sessionFailure;
  if (
    !isRecord(depositWorkflow) ||
    !hasExactKeys(depositWorkflow, [
      'financialActionsTrigger',
      'depositMenuItem',
      'toPlayerTile',
      'findBySelectedValue',
      'findByPlayerIdLabel',
      'playerIdInput',
      'findButton',
      'amountInput',
      'notesInput',
      'transferButton',
    ]) ||
    !isWorkflowControl(depositWorkflow.financialActionsTrigger) ||
    !isWorkflowControl(depositWorkflow.depositMenuItem) ||
    !isWorkflowControl(depositWorkflow.toPlayerTile) ||
    !isWorkflowControl(depositWorkflow.findBySelectedValue) ||
    typeof depositWorkflow.findByPlayerIdLabel !== 'string' ||
    !isWorkflowControl(depositWorkflow.playerIdInput) ||
    !isWorkflowControl(depositWorkflow.findButton) ||
    !isWorkflowControl(depositWorkflow.amountInput) ||
    !isWorkflowControl(depositWorkflow.notesInput) ||
    !isWorkflowControl(depositWorkflow.transferButton) ||
    !isRecord(signedInAgentIdentity) ||
    !hasExactKeys(signedInAgentIdentity, ['root', 'value']) ||
    typeof signedInAgentIdentity.root !== 'string' ||
    !isStructuredField(signedInAgentIdentity.value) ||
    !isRecord(lookup) ||
    !hasExactKeys(lookup, ['root', 'resolvedIdentity', 'currencyCode']) ||
    typeof lookup.root !== 'string' ||
    !isStructuredField(lookup.resolvedIdentity) ||
    !isStructuredField(lookup.currencyCode) ||
    !isRecord(preparedDeposit) ||
    !hasExactKeys(preparedDeposit, ['root', 'resolvedIdentity', 'amount', 'currencyCode']) ||
    typeof preparedDeposit.root !== 'string' ||
    !isStructuredField(preparedDeposit.resolvedIdentity) ||
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
  const contract = value as unknown as KemerBetAgentPageSelectorContractV2;
  const fields = [
    contract.signedInAgentIdentity.value,
    contract.lookup.resolvedIdentity,
    contract.lookup.currencyCode,
    contract.preparedDeposit.resolvedIdentity,
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
  requireNonemptyBounded(contract.depositWorkflow.findByPlayerIdLabel, 80);
  const workflowControls = [
    contract.depositWorkflow.financialActionsTrigger,
    contract.depositWorkflow.depositMenuItem,
    contract.depositWorkflow.toPlayerTile,
    contract.depositWorkflow.findBySelectedValue,
    contract.depositWorkflow.playerIdInput,
    contract.depositWorkflow.findButton,
    contract.depositWorkflow.amountInput,
    contract.depositWorkflow.notesInput,
    contract.depositWorkflow.transferButton,
  ];
  const workflowControlSignatures = workflowControls.map((control) => JSON.stringify(control));
  if (new Set(workflowControlSignatures).size !== workflowControlSignatures.length) unavailable();
  for (const control of workflowControls) {
    if (control.by === 'css') requireSelector(control.selector);
    else if (control.by === 'role') requireNonemptyBounded(control.name, 80);
    else if (control.by === 'label') requireNonemptyBounded(control.label, 80);
    else requireNonemptyBounded(control.text, 80);
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

interface AuthoritativePlayerLookup {
  readonly externalPlayerId: string;
  readonly internalPlayerId: number;
  readonly identityCandidates: readonly string[];
  readonly visibleIdentity: string | null;
  readonly currencyCode: 'ETB';
}

function parseLookupRequestUrl(rawUrl: string): URL | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (
    url.origin !== KEMERBET_AGENT_API_ORIGIN ||
    url.pathname !== KEMERBET_AGENT_PLAYER_LOOKUP_PATH ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.hash !== ''
  ) {
    return null;
  }
  return url;
}

function isExactPlayerLookupResponse(response: PlaywrightResponsePort): boolean {
  const url = parseLookupRequestUrl(response.url());
  return url !== null && response.request().method() === 'GET';
}

function parseAuthoritativePlayerLookup(
  response: PlaywrightResponsePort,
  requestedPlayerId: string,
  body: unknown,
): AuthoritativePlayerLookup {
  const url = parseLookupRequestUrl(response.url());
  if (response.status() !== 200 || response.request().method() !== 'GET' || url === null) {
    return unavailable();
  }
  const queryEntries = [...url.searchParams.entries()];
  if (
    queryEntries.length !== 1 ||
    queryEntries[0]?.[0] !== 'externalId' ||
    queryEntries[0]?.[1] !== requestedPlayerId
  ) {
    return unavailable();
  }
  if (!isRecord(body) || !isRecord(body.value)) unavailable();
  const value = body.value;
  if (
    !Number.isSafeInteger(value.id) ||
    (value.id as number) <= 0 ||
    typeof value.externalId !== 'string' ||
    value.externalId !== requestedPlayerId ||
    typeof value.currencyCode !== 'string' ||
    value.currencyCode !== 'ETB'
  ) {
    return unavailable();
  }
  const identityCandidates = [...new Set([value.userName, value.email])]
    .filter((candidate): candidate is string => typeof candidate === 'string')
    .map((candidate) => requireNonemptyBounded(candidate, 256));
  if (identityCandidates.length < 1 || identityCandidates.length > 2) unavailable();
  return {
    externalPlayerId: requestedPlayerId,
    internalPlayerId: value.id as number,
    identityCandidates,
    visibleIdentity: null,
    currencyCode: 'ETB',
  };
}

function exactPlayerDepositPayload(
  value: unknown,
  lookup: AuthoritativePlayerLookup,
  amountText: string,
): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ['playerId', 'amount', 'notes'])) return false;
  return (
    value.playerId === lookup.internalPlayerId &&
    value.amount === Number(amountText) &&
    Number.isFinite(value.amount) &&
    value.notes === ''
  );
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

export interface ObserveKemerBetAgentIdentityFingerprintOptions {
  readonly page: Page | PlaywrightPagePort;
  readonly platformAgentAccountId: string;
  readonly selectorContract: KemerBetAgentPageSelectorContractV2;
  readonly fingerprintAgentIdentity: KemerBetAgentIdentityFingerprinter;
  readonly timeoutMs?: number;
  readonly pollDelay?: (milliseconds: number) => Promise<void>;
  readonly monotonicNow?: () => number;
}

/**
 * Observe the exact authenticated Agent header and return only its keyed fingerprint. The raw
 * KemerBet identity is kept inside this function, is never logged, and is observed twice around a
 * route/session-failure recheck before a binding can be emitted.
 */
export async function observeKemerBetAgentIdentityFingerprint(
  options: ObserveKemerBetAgentIdentityFingerprintOptions,
): Promise<string> {
  assertKemerBetAgentPageSelectorContractV2(options.selectorContract);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      options.platformAgentAccountId,
    ) ||
    options.platformAgentAccountId === '00000000-0000-0000-0000-000000000000'
  ) {
    unavailable();
  }
  const page = options.page as PlaywrightPagePort;
  const contract = options.selectorContract;
  const timeoutMs = requireBoundedInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 100, 120_000);
  const pollDelay = options.pollDelay ?? defaultPollDelay;
  const monotonicNow = options.monotonicNow ?? Date.now;

  const assertExactAuthenticatedRoute = async (): Promise<void> => {
    if (requireAllowedAgentUrl(page.url()) !== KEMERBET_AGENT_DEPOSIT_URL) unavailable();
    for (const selector of [contract.sessionFailure.captcha, contract.sessionFailure.signInForm]) {
      const locator = page.locator(selector);
      const count = await locator.count();
      if (count > 20) unavailable();
      for (let index = 0; index < count; index += 1) {
        if (await locator.nth(index).isVisible()) unavailable();
      }
    }
  };

  const observeFingerprint = async (): Promise<string | null> => {
    const root = await observeStrictLocator(page, contract.signedInAgentIdentity.root);
    if (root === null) return null;
    const rawIdentity = await observeStructuredField(
      root,
      contract.signedInAgentIdentity.value,
      256,
      false,
    );
    if (rawIdentity === null) return null;
    let fingerprint: string;
    try {
      fingerprint = options.fingerprintAgentIdentity(options.platformAgentAccountId, rawIdentity);
    } catch {
      return unavailable();
    }
    if (!/^hmac-sha256-agent-identity-v1:[0-9a-f]{64}$/u.test(fingerprint)) unavailable();
    return fingerprint;
  };

  const deadline = monotonicNow() + timeoutMs;
  const maximumPolls = Math.ceil(timeoutMs / 10) + 2;
  for (let poll = 0; poll < maximumPolls; poll += 1) {
    await assertExactAuthenticatedRoute();
    const first = await observeFingerprint();
    if (first !== null) {
      await assertExactAuthenticatedRoute();
      const second = await observeFingerprint();
      if (second !== null) {
        if (second !== first) unavailable();
        await assertExactAuthenticatedRoute();
        return first;
      }
    }
    const remaining = deadline - monotonicNow();
    if (remaining <= 0) break;
    await pollDelay(Math.min(50, Math.max(1, remaining)));
  }
  return unavailable();
}

function requireExactColumnIndexes(
  headers: readonly string[],
  columns: KemerBetAgentPageSelectorContractV2['history']['columns'],
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
  assertKemerBetAgentPageSelectorContractV2(options.selectorContract);
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
  let authoritativeLookup: AuthoritativePlayerLookup | null = null;
  let preparedAmountText: string | null = null;

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

  function workflowControlLocator(control: KemerBetAgentWorkflowControl): PlaywrightLocatorPort {
    return control.by === 'css'
      ? page.locator(control.selector)
      : control.by === 'label'
        ? page.getByLabel(control.label, { exact: true })
        : control.by === 'role'
          ? page.getByRole(control.role, { name: control.name, exact: true })
          : page.getByText(control.text, { exact: true });
  }

  async function observeWorkflowControl(
    control: KemerBetAgentWorkflowControl,
    requireEnabled: boolean,
  ): Promise<PlaywrightLocatorPort | null> {
    const candidate = workflowControlLocator(control);
    const count = await candidate.count();
    if (count === 0) return null;
    if (count !== 1) unavailable();
    if (!(await candidate.isVisible())) return null;
    if (requireEnabled && !(await candidate.isEnabled())) return null;
    return candidate;
  }

  async function exactWorkflowControl(
    control: KemerBetAgentWorkflowControl,
  ): Promise<PlaywrightLocatorPort> {
    const locator = await pollAuthenticated(() => observeWorkflowControl(control, true));
    if (locator === null) unavailable();
    return locator;
  }

  async function observePlayerLookupSurface(): Promise<'absent' | 'ready'> {
    const [findBy, playerIdInput, findButton] = await Promise.all([
      observeWorkflowControl(contract.depositWorkflow.findBySelectedValue, false),
      observeWorkflowControl(contract.depositWorkflow.playerIdInput, false),
      observeWorkflowControl(contract.depositWorkflow.findButton, false),
    ]);
    const visibleControls = [findBy, playerIdInput, findButton].filter(
      (control) => control !== null,
    ).length;
    if (visibleControls === 0) return 'absent';
    if (findBy === null || playerIdInput === null || findButton === null) unavailable();
    if (
      normalizeWhitespace(await findBy.innerText()) !== contract.depositWorkflow.findByPlayerIdLabel
    ) {
      unavailable();
    }
    return 'ready';
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
    authoritativeLookup = null;
    preparedAmountText = null;
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await requireReadyAgentPage();
  }

  return {
    sessionKey,

    async adoptCurrentDepositPageWithoutNavigation() {
      if (expectedUrl !== null) unavailable();
      const current = requireAllowedAgentUrl(page.url());
      if (current !== KEMERBET_AGENT_DEPOSIT_URL) unavailable();
      expectedUrl = current;
      try {
        await requireReadyAgentPage();
      } catch (error) {
        expectedUrl = null;
        throw error;
      }
    },

    async probeAuthenticatedSession() {
      await navigateTo(KEMERBET_AGENT_HISTORY_URL);
    },

    async goto(rawUrl) {
      await navigateTo(rawUrl);
    },

    async currentUrl() {
      return requireReadyAgentPage();
    },

    async openPlayerDeposit() {
      await requireReadyAgentPage();
      if (expectedUrl !== KEMERBET_AGENT_DEPOSIT_URL) unavailable();
      if ((await observePlayerLookupSurface()) === 'ready') {
        await requireReadyAgentPage();
        if ((await observePlayerLookupSurface()) !== 'ready') unavailable();
        return;
      }
      for (const selector of [
        contract.depositWorkflow.financialActionsTrigger,
        contract.depositWorkflow.depositMenuItem,
        contract.depositWorkflow.toPlayerTile,
      ]) {
        await (await exactWorkflowControl(selector)).click({ timeout: timeoutMs });
        await requireReadyAgentPage();
      }
      const ready = await pollAuthenticated(async () =>
        (await observePlayerLookupSurface()) === 'ready' ? true : null,
      );
      if (ready !== true) unavailable();
    },

    async lookupPlayer(playerId) {
      await requireReadyAgentPage();
      if (
        expectedUrl !== KEMERBET_AGENT_DEPOSIT_URL ||
        playerId.length < 1 ||
        playerId.length > 128 ||
        playerId !== playerId.trim() ||
        /\r|\n|\0/u.test(playerId)
      )
        unavailable();
      const findBy = await exactWorkflowControl(contract.depositWorkflow.findBySelectedValue);
      if (
        normalizeWhitespace(await findBy.innerText()) !==
        contract.depositWorkflow.findByPlayerIdLabel
      ) {
        unavailable();
      }
      await (
        await exactWorkflowControl(contract.depositWorkflow.playerIdInput)
      ).fill(playerId, {
        timeout: timeoutMs,
      });
      authoritativeLookup = null;
      preparedPlayerId = null;
      preparedAmountText = null;
      const responsePromise = page.waitForResponse(isExactPlayerLookupResponse, {
        timeout: timeoutMs,
      });
      try {
        await (
          await exactWorkflowControl(contract.depositWorkflow.findButton)
        ).click({
          timeout: timeoutMs,
        });
        const response = await responsePromise;
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          unavailable();
        }
        authoritativeLookup = parseAuthoritativePlayerLookup(response, playerId, body);
      } catch {
        await responsePromise.catch(() => undefined);
        unavailable();
      }
      await requireReadyAgentPage();
    },

    async fillDeposit(amount, notes) {
      await requireReadyAgentPage();
      if (
        expectedUrl !== KEMERBET_AGENT_DEPOSIT_URL ||
        !/^[0-9]+\.[0-9]{2}$/u.test(amount) ||
        notes !== ''
      )
        unavailable();
      await (
        await exactWorkflowControl(contract.depositWorkflow.amountInput)
      ).fill(amount, {
        timeout: timeoutMs,
      });
      await (
        await exactWorkflowControl(contract.depositWorkflow.notesInput)
      ).fill(notes, {
        timeout: timeoutMs,
      });
      await requireReadyAgentPage();
      preparedAmountText = amount;
    },

    async transferOnce() {
      await requireReadyAgentPage();
      const exactLookup = authoritativeLookup;
      const exactAmount = preparedAmountText;
      if (
        expectedUrl !== KEMERBET_AGENT_DEPOSIT_URL ||
        exactLookup === null ||
        exactLookup.visibleIdentity === null ||
        exactAmount === null
      ) {
        unavailable();
      }
      let resolveRouteResult: ((allowed: boolean) => void) | null = null;
      const routeResult = new Promise<boolean>((resolve) => {
        resolveRouteResult = resolve;
      });
      const routeHandler = async (route: PlaywrightRoutePort): Promise<void> => {
        const request = route.request();
        let payload: unknown;
        try {
          payload = request.postDataJSON();
        } catch {
          payload = null;
        }
        const allowed =
          request.url() === KEMERBET_AGENT_PLAYER_DEPOSIT_URL &&
          request.method() === 'POST' &&
          exactPlayerDepositPayload(payload, exactLookup, exactAmount);
        try {
          if (allowed) await route.continue();
          else await route.abort('blockedbyclient');
        } finally {
          resolveRouteResult?.(allowed);
        }
      };
      await page.route(KEMERBET_AGENT_PLAYER_DEPOSIT_URL, routeHandler, { times: 1 });
      let allowed = false;
      try {
        await (
          await exactWorkflowControl(contract.depositWorkflow.transferButton)
        ).click({
          timeout: timeoutMs,
        });
        allowed = await Promise.race([
          routeResult,
          new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
        ]);
      } finally {
        await page.unroute(KEMERBET_AGENT_PLAYER_DEPOSIT_URL, routeHandler);
      }
      if (!allowed) unavailable();
      await requireReadyAgentPage();
    },

    async readAgentLookup(): Promise<KemerBetAgentLookupView> {
      await requireReadyAgentPage();
      if (expectedUrl !== KEMERBET_AGENT_DEPOSIT_URL) unavailable();
      const exactLookup = authoritativeLookup;
      if (exactLookup === null) unavailable();
      const root = await waitStrictLocator(page, contract.lookup.root);
      const resolvedIdentity = await waitStructuredField(
        root,
        contract.lookup.resolvedIdentity,
        256,
        false,
      );
      const currencyCode = await waitStructuredField(root, contract.lookup.currencyCode, 12);
      if (
        currencyCode !== exactLookup.currencyCode ||
        !exactLookup.identityCandidates.includes(resolvedIdentity)
      ) {
        unavailable();
      }
      authoritativeLookup = { ...exactLookup, visibleIdentity: resolvedIdentity };
      preparedPlayerId = exactLookup.externalPlayerId;
      return { playerId: exactLookup.externalPlayerId, currencyCode };
    },

    async readAgentPreparedDeposit(): Promise<KemerBetAgentPreparedDepositView> {
      await requireReadyAgentPage();
      if (expectedUrl !== KEMERBET_AGENT_DEPOSIT_URL) unavailable();
      const exactLookup = authoritativeLookup;
      if (exactLookup === null || exactLookup.visibleIdentity === null) unavailable();
      const root = await waitStrictLocator(page, contract.preparedDeposit.root);
      const resolvedIdentity = await waitStructuredField(
        root,
        contract.preparedDeposit.resolvedIdentity,
        256,
        false,
      );
      const amountText = await waitStructuredField(root, contract.preparedDeposit.amount, 80);
      const currencyCode = await waitStructuredField(
        root,
        contract.preparedDeposit.currencyCode,
        12,
      );
      if (
        preparedPlayerId === null ||
        preparedPlayerId !== exactLookup.externalPlayerId ||
        resolvedIdentity !== exactLookup.visibleIdentity ||
        currencyCode !== exactLookup.currencyCode
      ) {
        unavailable();
      }
      return { playerId: exactLookup.externalPlayerId, amountText, currencyCode };
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
