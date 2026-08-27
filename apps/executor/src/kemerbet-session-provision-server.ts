import { chmod, lstat, mkdir, realpath, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium, type BrowserContext, type Page, type Route } from 'playwright-core';

import {
  KEMERBET_AGENT_IDENTITY_HMAC_KEY_FILE,
  KEMERBET_SELECTOR_CONTRACT_FILE,
} from '@fetanagent/config/executor';

import {
  assertKemerBetBrowserExecutable,
  loadKemerBetSelectorContract,
} from './executor-runtime-isolation.js';
import {
  createKemerBetAgentIdentityFingerprinter,
  type KemerBetAgentIdentityFingerprinter,
} from './kemerbet-agent-identity-fingerprint.js';
import {
  type KemerBetSingletonArtifactFileSystem,
  removeStaleChromiumSingletonArtifacts as removeStaleChromiumSingletonArtifactsFromProfile,
} from './kemerbet-chromium-profile.js';
import {
  createKemerBetNoTransferReadinessSealProbeFromPage,
  runKemerBetNoTransferReadinessSeal,
  type KemerBetNoTransferReadinessSealStage,
  type KemerBetReadinessSealForbiddenRequestDiagnostic,
  type KemerBetReadinessSealForbiddenRequestKind,
  type KemerBetReadinessSealForbiddenRequestMethod,
  type KemerBetReadinessSealForbiddenRequestReason,
  type KemerBetReadinessSealForbiddenRequestTarget,
} from './kemerbet-no-transfer-readiness-seal.js';
import {
  assertKemerBetAgentPageSelectorContractV2,
  createPlaywrightKemerBetAgentPage,
  observeKemerBetAgentIdentityFingerprint,
  type KemerBetAgentPageSelectorContractV2,
  type KemerBetAgentWorkflowControl,
} from './playwright-kemerbet-agent-page.js';

const CONTROL_ROOT = '/run/fetanagent-kemerbet-session-control';
const CONTROL_SOCKET = `${CONTROL_ROOT}/session.sock`;
const PROFILE_ROOT = '/var/lib/fetanagent/kemerbet-sessions';
const CHROMIUM_PATH = '/usr/bin/chromium';
const LOGIN_URL = 'https://agentsystem.admindigi.com/login';
const WEB_ORIGIN = 'https://agentsystem.admindigi.com';
const API_ORIGIN = 'https://admin-api.agt-digi.com';
const DEPOSIT_PATH = '/Wallet/PlayerEPOSDeposit';
const REFRESH_TOKEN_PATH = '/Account/RefreshToken';
const RECAPTCHA_ORIGINS = new Set(['https://www.google.com', 'https://www.recaptcha.net']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_BODY_BYTES = 1_024;
const MAX_PROVIDER_REFRESH_BODY_BYTES = 8_192;
const LOGIN_LIFETIME_MS = 10 * 60 * 1_000;
const AUTHENTICATED_SESSION_LIFETIME_MS = 12 * 60 * 60 * 1_000;
const VIEWPORT = Object.freeze({ width: 1280, height: 720 });
const NAMED_KEYS = new Set(['Backspace', 'Delete', 'Enter', 'Escape', 'Tab']);

interface SafeStat {
  readonly mode: number;
  readonly uid: number;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

interface StartInput {
  readonly platformAgentAccountId: string;
  readonly requestId: string;
}

interface ReadinessSealInput {
  readonly requestId: string;
}

interface KemerBetSessionCheckpointInput {
  readonly accountId: string;
  readonly context: BrowserContext;
  readonly page: Page;
}

export interface KemerBetProvisionCheckpointResult {
  readonly checkpointed: true;
  readonly identifiersRedacted: true;
  readonly moneyMoved: false;
  readonly providerSessionFresh: true;
  readonly transferDisabled: true;
}

export interface KemerBetProvisionCheckpointDependencies {
  readonly verifyAuthenticatedPage?: (
    input: KemerBetSessionCheckpointInput & { readonly effectiveUserId: number },
  ) => Promise<void>;
}

interface PointerInput {
  readonly kind: 'pointer';
  readonly requestId: string;
  readonly x: number;
  readonly y: number;
}

interface KeyInput {
  readonly key: string;
  readonly kind: 'key';
  readonly requestId: string;
}

type SessionInput = PointerInput | KeyInput;

export interface KemerBetProvisionSessionStatus {
  readonly active: boolean;
  readonly expiresAt?: string;
  readonly imageBase64?: string;
  readonly imageContentType?: 'image/jpeg';
  readonly loginRequired: boolean;
  readonly signedIn: boolean;
  readonly transferDisabled: true;
}

export interface KemerBetProvisionServerDependencies {
  readonly assertBrowserExecutable?: () => Promise<void>;
  readonly checkpointSignedInPage?: (input: KemerBetSessionCheckpointInput) => Promise<void>;
  readonly createReadinessProbeFromPage?: typeof createKemerBetNoTransferReadinessSealProbeFromPage;
  readonly effectiveUserId?: number;
  readonly environment?: NodeJS.ProcessEnv;
  readonly launchPersistentContext?: typeof chromium.launchPersistentContext;
  readonly now?: () => Date;
  readonly runReadinessSeal?: typeof runKemerBetNoTransferReadinessSeal;
  readonly setTimer?: typeof setTimeout;
  readonly clearTimer?: typeof clearTimeout;
  readonly log?: (event: 'started' | 'signed_in' | 'stopped') => void;
  readonly logReadinessSealFailure?: (event: KemerBetReadinessSealFailureEvent) => void;
}

export interface KemerBetReadinessSealFailureEvent {
  readonly component: 'kemerbet_session_provision';
  readonly detailsRedacted: true;
  readonly event: 'readiness_seal_failed';
  readonly forbiddenRequest?: KemerBetReadinessSealForbiddenRequestDiagnostic;
  readonly stage?: KemerBetNoTransferReadinessSealStage;
}

const KEMERBET_READINESS_SEAL_FAILURE_STAGES = Object.freeze({
  environment_guard: true,
  readiness_inputs: true,
  signed_in_page: true,
  route_guard: true,
  agent_identity: true,
  agent_session_guard: true,
  agent_identity_marker: true,
  agent_identity_value: true,
  agent_identity_stability: true,
  page_adoption: true,
  lookup_surface: true,
  lookup_request: true,
  lookup_input: true,
  lookup_input_blurred: true,
  lookup_action: true,
  lookup_click_actionability: true,
  lookup_native_click: true,
  lookup_response: true,
  lookup_network_request: true,
  forbidden_request: true,
  lookup_contract: true,
  lookup_result: true,
  lookup_reset: true,
  final_guard: true,
  binding_write: true,
} satisfies Readonly<Record<KemerBetNoTransferReadinessSealStage, true>>);

const KEMERBET_READINESS_SEAL_FORBIDDEN_REQUEST_REASONS = Object.freeze({
  exact_financial_endpoint: true,
  exact_auth_session_endpoint: true,
  non_read_method: true,
  noncanonical_navigation: true,
  non_https: true,
  url_credentials: true,
  explicit_port: true,
  fragment: true,
  malformed_url: true,
} satisfies Readonly<Record<KemerBetReadinessSealForbiddenRequestReason, true>>);

const KEMERBET_READINESS_SEAL_FORBIDDEN_REQUEST_TARGETS = Object.freeze({
  agent_api: true,
  agent_auth_session: true,
  agent_web: true,
  known_telemetry: true,
  recaptcha: true,
  third_party: true,
  unparseable: true,
} satisfies Readonly<Record<KemerBetReadinessSealForbiddenRequestTarget, true>>);

const KEMERBET_READINESS_SEAL_FORBIDDEN_REQUEST_METHODS = Object.freeze({
  GET: true,
  HEAD: true,
  OPTIONS: true,
  POST: true,
  PUT: true,
  PATCH: true,
  DELETE: true,
  OTHER: true,
} satisfies Readonly<Record<KemerBetReadinessSealForbiddenRequestMethod, true>>);

const KEMERBET_READINESS_SEAL_FORBIDDEN_REQUEST_KINDS = Object.freeze({
  main_navigation: true,
  subframe_navigation: true,
  subresource: true,
} satisfies Readonly<Record<KemerBetReadinessSealForbiddenRequestKind, true>>);

function fixedForbiddenRequestDiagnostic(
  value: unknown,
): KemerBetReadinessSealForbiddenRequestDiagnostic | undefined {
  try {
    const object = exactObject(value, ['reason', 'target', 'method', 'kind']);
    if (object === undefined) return undefined;
    const reason = object.reason;
    const target = object.target;
    const method = object.method;
    const kind = object.kind;
    if (
      typeof reason !== 'string' ||
      !Object.prototype.hasOwnProperty.call(
        KEMERBET_READINESS_SEAL_FORBIDDEN_REQUEST_REASONS,
        reason,
      ) ||
      typeof target !== 'string' ||
      !Object.prototype.hasOwnProperty.call(
        KEMERBET_READINESS_SEAL_FORBIDDEN_REQUEST_TARGETS,
        target,
      ) ||
      typeof method !== 'string' ||
      !Object.prototype.hasOwnProperty.call(
        KEMERBET_READINESS_SEAL_FORBIDDEN_REQUEST_METHODS,
        method,
      ) ||
      typeof kind !== 'string' ||
      !Object.prototype.hasOwnProperty.call(KEMERBET_READINESS_SEAL_FORBIDDEN_REQUEST_KINDS, kind)
    ) {
      return undefined;
    }
    return Object.freeze({
      reason: reason as KemerBetReadinessSealForbiddenRequestReason,
      target: target as KemerBetReadinessSealForbiddenRequestTarget,
      method: method as KemerBetReadinessSealForbiddenRequestMethod,
      kind: kind as KemerBetReadinessSealForbiddenRequestKind,
    });
  } catch {
    return undefined;
  }
}

export function createKemerBetReadinessSealFailureEvent(
  stage: unknown,
  forbiddenRequest?: unknown,
): KemerBetReadinessSealFailureEvent {
  const fixed = {
    component: 'kemerbet_session_provision',
    event: 'readiness_seal_failed',
    detailsRedacted: true,
  } as const;
  if (
    typeof stage !== 'string' ||
    !Object.prototype.hasOwnProperty.call(KEMERBET_READINESS_SEAL_FAILURE_STAGES, stage)
  ) {
    return Object.freeze(fixed);
  }
  const fixedStage = stage as KemerBetNoTransferReadinessSealStage;
  const fixedForbiddenRequest = fixedForbiddenRequestDiagnostic(forbiddenRequest);
  return fixedStage === 'forbidden_request' && fixedForbiddenRequest !== undefined
    ? Object.freeze({ ...fixed, stage: fixedStage, forbiddenRequest: fixedForbiddenRequest })
    : Object.freeze({ ...fixed, stage: fixedStage });
}

export interface KemerBetReadinessSealFailureSnapshot {
  readonly forbiddenRequest?: KemerBetReadinessSealForbiddenRequestDiagnostic;
  readonly stage?: KemerBetNoTransferReadinessSealStage;
}

export function createKemerBetReadinessSealFailureTracker(): {
  readonly begin: () => void;
  readonly clear: () => void;
  readonly consume: () => KemerBetReadinessSealFailureSnapshot;
  readonly reportForbiddenRequest: (
    diagnostic: KemerBetReadinessSealForbiddenRequestDiagnostic,
  ) => void;
  readonly reportStage: (stage: KemerBetNoTransferReadinessSealStage) => void;
} {
  let stage: KemerBetNoTransferReadinessSealStage | undefined;
  let forbiddenRequest: KemerBetReadinessSealForbiddenRequestDiagnostic | undefined;
  const clear = (): void => {
    stage = undefined;
    forbiddenRequest = undefined;
  };
  return Object.freeze({
    begin: () => {
      stage = 'signed_in_page';
      forbiddenRequest = undefined;
    },
    clear,
    consume: () => {
      const snapshot =
        forbiddenRequest !== undefined
          ? Object.freeze({ stage, forbiddenRequest })
          : stage !== undefined
            ? Object.freeze({ stage })
            : Object.freeze({});
      clear();
      return snapshot;
    },
    reportForbiddenRequest: (diagnostic) => {
      if (forbiddenRequest === undefined) {
        forbiddenRequest = diagnostic;
        stage = 'forbidden_request';
      }
    },
    reportStage: (nextStage) => {
      if (forbiddenRequest === undefined || nextStage === 'forbidden_request') {
        stage = nextStage;
      }
    },
  });
}

export class KemerBetProvisionServerUnavailableError extends Error {
  constructor() {
    super('The private KemerBet session provision service is unavailable.');
    this.name = 'KemerBetProvisionServerUnavailableError';
  }
}

function unavailable(): never {
  throw new KemerBetProvisionServerUnavailableError();
}

export async function removeStaleChromiumSingletonArtifacts(
  profilePath: string,
  fileSystem?: KemerBetSingletonArtifactFileSystem,
): Promise<void> {
  try {
    await removeStaleChromiumSingletonArtifactsFromProfile(profilePath, fileSystem);
  } catch {
    unavailable();
  }
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const object = value as Record<string, unknown>;
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
    ? object
    : undefined;
}

function assertEnvironment(environment: NodeJS.ProcessEnv, effectiveUserId: number): void {
  if (
    effectiveUserId !== 10001 ||
    environment.NODE_ENV !== 'production' ||
    environment.FINANCIAL_ACTIONS_MODE !== 'dry_run' ||
    environment.KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED !== 'true' ||
    environment.KEMERBET_EXECUTOR_ENABLED !== 'false' ||
    environment.KEMERBET_FINAL_ACTION_ENABLED !== 'false' ||
    environment.KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED !== 'false' ||
    environment.INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED !== 'false'
  ) {
    unavailable();
  }
}

async function assertSafeDirectory(path: string, effectiveUserId: number): Promise<void> {
  const before = (await lstat(path)) as SafeStat;
  if (
    !before.isDirectory() ||
    before.isSymbolicLink() ||
    before.uid !== effectiveUserId ||
    (before.mode & 0o777) !== 0o700 ||
    (await realpath(path)) !== path
  ) {
    unavailable();
  }
  const after = (await lstat(path)) as SafeStat;
  if (
    !after.isDirectory() ||
    after.isSymbolicLink() ||
    after.uid !== before.uid ||
    after.mode !== before.mode
  ) {
    unavailable();
  }
}

async function prepareProfile(accountId: string, effectiveUserId: number): Promise<string> {
  if (!UUID_PATTERN.test(accountId)) unavailable();
  await assertSafeDirectory(PROFILE_ROOT, effectiveUserId);
  const profilePath = resolve(PROFILE_ROOT, accountId);
  if (profilePath !== `${PROFILE_ROOT}/${accountId}`) unavailable();
  await mkdir(profilePath, { mode: 0o700 }).catch((error: unknown) => {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'EEXIST'
    ) {
      unavailable();
    }
  });
  await assertSafeDirectory(profilePath, effectiveUserId);
  await assertSafeDirectory(PROFILE_ROOT, effectiveUserId);
  return profilePath;
}

function validPageUrl(value: string): 'agents' | 'login' | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.origin !== WEB_ORIGIN || url.username || url.password || url.hash) return undefined;
  if (url.pathname === '/agents' && url.search === '') return 'agents';
  if (url.pathname === '/login' && (url.search === '' || url.search === '?et=1')) return 'login';
  return undefined;
}

function validateCheckpointSelectorContract(value: unknown): KemerBetAgentPageSelectorContractV2 {
  assertKemerBetAgentPageSelectorContractV2(value);
  return value;
}

function checkpointWorkflowControlLocator(page: Page, control: KemerBetAgentWorkflowControl) {
  if (control.by === 'css') return page.locator(control.selector);
  if (control.by === 'label') return page.getByLabel(control.label, { exact: true });
  if (control.by === 'role') {
    return page.getByRole(control.role, { exact: true, includeHidden: true, name: control.name });
  }
  return page.getByText(control.text, { exact: true });
}

async function requireNoActionableCheckpointTransfer(
  page: Page,
  selectorContract: KemerBetAgentPageSelectorContractV2,
): Promise<void> {
  const transfer = checkpointWorkflowControlLocator(
    page,
    selectorContract.depositWorkflow.transferButton,
  );
  const count = await transfer.count();
  if (count > 20) return unavailable();
  for (let index = 0; index < count; index += 1) {
    const candidate = transfer.nth(index);
    if ((await candidate.isVisible()) && (await candidate.isEnabled())) return unavailable();
  }
}

function requireExactCheckpointTopology(input: KemerBetSessionCheckpointInput): void {
  const pages = input.context.pages();
  if (
    input.page.context() !== input.context ||
    input.page.isClosed() ||
    pages.length !== 1 ||
    pages[0] !== input.page ||
    input.context.serviceWorkers().length !== 0 ||
    validPageUrl(input.page.url()) !== 'agents'
  ) {
    unavailable();
  }
}

/**
 * Revalidate the retained provider session immediately before it can be snapshotted. The raw
 * identity and refresh material never leave this function; success is represented only by the
 * fixed aggregate checkpoint response emitted after the same context has been terminally closed.
 */
async function verifyKemerBetProvisionCheckpointAuthenticatedPage(
  input: KemerBetSessionCheckpointInput & { readonly effectiveUserId: number },
): Promise<void> {
  const [selectorContract, fingerprintAgentIdentity] = await Promise.all([
    loadKemerBetSelectorContract({
      filePath: KEMERBET_SELECTOR_CONTRACT_FILE,
      validate: validateCheckpointSelectorContract,
    }),
    createKemerBetAgentIdentityFingerprinter({
      effectiveUserId: input.effectiveUserId,
      secretFilePath: KEMERBET_AGENT_IDENTITY_HMAC_KEY_FILE,
    }),
  ]);
  const observedFingerprint = await observeKemerBetAgentIdentityFingerprint({
    page: input.page,
    platformAgentAccountId: input.accountId,
    selectorContract,
    fingerprintAgentIdentity,
    timeoutMs: 30_000,
  });
  const agentPage = createPlaywrightKemerBetAgentPage({
    expectedAgentIdentityFingerprint: observedFingerprint,
    fingerprintAgentIdentity,
    page: input.page,
    platformAgentAccountId: input.accountId,
    selectorContract,
    sessionKey: `kemerbet-checkpoint-v1:${input.accountId}`,
    timeoutMs: 30_000,
  });
  await agentPage.adoptCurrentDepositPageWithoutNavigation();
  await requireNoActionableCheckpointTransfer(input.page, selectorContract);
}

export async function checkpointKemerBetProvisionSignedInPage(
  input: KemerBetSessionCheckpointInput & { readonly effectiveUserId: number },
  dependencies: KemerBetProvisionCheckpointDependencies = {},
): Promise<void> {
  if (
    !UUID_PATTERN.test(input.accountId) ||
    input.accountId === '00000000-0000-0000-0000-000000000000' ||
    input.effectiveUserId !== 10_001
  ) {
    unavailable();
  }
  requireExactCheckpointTopology(input);
  await input.page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
  await input.page.waitForTimeout(250);
  requireExactCheckpointTopology(input);
  await (
    dependencies.verifyAuthenticatedPage ?? verifyKemerBetProvisionCheckpointAuthenticatedPage
  )(input);
  requireExactCheckpointTopology(input);
}

export function isAllowedKemerBetSessionRequest(input: {
  readonly headers?: Readonly<Record<string, string>>;
  readonly isMainFrame: boolean;
  readonly isNavigationRequest: boolean;
  readonly method: string;
  readonly pageUrl: string;
  readonly postData?: string | null;
  readonly redirectedFrom?: boolean;
  readonly resourceType?: string;
  readonly requestUrl: string;
}): boolean {
  let url: URL;
  try {
    url = new URL(input.requestUrl);
  } catch {
    return false;
  }
  const pageState = validPageUrl(input.pageUrl);
  const exactDeposit = url.origin === API_ORIGIN && url.pathname === DEPOSIT_PATH;
  const refreshTokenEndpoint = url.origin === API_ORIGIN && url.pathname === REFRESH_TOKEN_PATH;
  const normalizedHeaders = Object.fromEntries(
    Object.entries(input.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const exactRefreshToken = (() => {
    if (
      pageState !== 'agents' ||
      !input.isMainFrame ||
      input.isNavigationRequest ||
      input.method !== 'POST' ||
      (input.resourceType !== 'fetch' && input.resourceType !== 'xhr') ||
      input.redirectedFrom === true ||
      url.origin !== API_ORIGIN ||
      url.pathname !== REFRESH_TOKEN_PATH ||
      input.requestUrl !== `${API_ORIGIN}${REFRESH_TOKEN_PATH}` ||
      url.search !== '' ||
      url.hash !== '' ||
      url.username !== '' ||
      url.password !== '' ||
      url.port !== '' ||
      normalizedHeaders['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !==
        'application/json' ||
      normalizedHeaders.grant_type !== 'refresh_token' ||
      typeof input.postData !== 'string' ||
      Buffer.byteLength(input.postData, 'utf8') > MAX_PROVIDER_REFRESH_BODY_BYTES
    ) {
      return false;
    }
    try {
      const parsed = JSON.parse(input.postData) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
      const object = parsed as Record<string, unknown>;
      const refreshToken = object.refreshToken;
      return (
        Object.keys(object).length === 1 &&
        typeof refreshToken === 'string' &&
        refreshToken.length >= 16 &&
        refreshToken.length <= 4_096 &&
        !/[\u0000-\u001f\u007f]/u.test(refreshToken)
      );
    } catch {
      return false;
    }
  })();
  const mutatingAfterLogin =
    pageState === 'agents' &&
    !exactRefreshToken &&
    input.method !== 'GET' &&
    input.method !== 'HEAD' &&
    input.method !== 'OPTIONS';
  const exactRecaptchaFrame =
    !input.isMainFrame &&
    RECAPTCHA_ORIGINS.has(url.origin) &&
    url.pathname.startsWith('/recaptcha/');
  const navigationAllowed =
    !input.isNavigationRequest || validPageUrl(url.toString()) !== undefined || exactRecaptchaFrame;
  return (
    !exactDeposit &&
    (!refreshTokenEndpoint || exactRefreshToken) &&
    !mutatingAfterLogin &&
    navigationAllowed
  );
}

async function guardedRoute(route: Route, page: Page, onBlockedRequest: () => void): Promise<void> {
  const request = route.request();
  if (
    !isAllowedKemerBetSessionRequest({
      isMainFrame: request.frame() === page.mainFrame(),
      isNavigationRequest: request.isNavigationRequest(),
      headers: request.headers(),
      method: request.method(),
      pageUrl: page.url(),
      postData: request.postData(),
      redirectedFrom: request.redirectedFrom() !== null,
      resourceType: request.resourceType(),
      requestUrl: request.url(),
    })
  ) {
    try {
      onBlockedRequest();
    } catch {
      // Privacy-safe attempt telemetry cannot weaken the existing local abort boundary.
    }
    await route.abort('blockedbyclient');
    return;
  }
  await route.continue();
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers['content-type'];
  if (contentType !== 'application/json') unavailable();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunkValue of request) {
    const chunk = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue);
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) unavailable();
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return unavailable();
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const serialized = JSON.stringify(body);
  response.writeHead(status, {
    'cache-control': 'no-store, max-age=0',
    'content-length': Buffer.byteLength(serialized),
    'content-type': 'application/json; charset=utf-8',
    pragma: 'no-cache',
  });
  response.end(serialized);
}

function validStartInput(value: unknown): StartInput | undefined {
  const object = exactObject(value, ['platformAgentAccountId', 'requestId']);
  return object &&
    typeof object.platformAgentAccountId === 'string' &&
    UUID_PATTERN.test(object.platformAgentAccountId) &&
    typeof object.requestId === 'string' &&
    REQUEST_ID_PATTERN.test(object.requestId)
    ? (object as unknown as StartInput)
    : undefined;
}

function validReadinessSealInput(value: unknown): ReadinessSealInput | undefined {
  const object = exactObject(value, ['requestId']);
  return object && typeof object.requestId === 'string' && REQUEST_ID_PATTERN.test(object.requestId)
    ? (object as unknown as ReadinessSealInput)
    : undefined;
}

function validSessionInput(value: unknown): SessionInput | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === 'pointer') {
    const object = exactObject(value, ['kind', 'requestId', 'x', 'y']);
    return object &&
      typeof object.requestId === 'string' &&
      REQUEST_ID_PATTERN.test(object.requestId) &&
      Number.isInteger(object.x) &&
      Number(object.x) >= 0 &&
      Number(object.x) < VIEWPORT.width &&
      Number.isInteger(object.y) &&
      Number(object.y) >= 0 &&
      Number(object.y) < VIEWPORT.height
      ? (object as unknown as PointerInput)
      : undefined;
  }
  if (candidate.kind === 'key') {
    const object = exactObject(value, ['key', 'kind', 'requestId']);
    const key = object?.key;
    return object &&
      typeof object.requestId === 'string' &&
      REQUEST_ID_PATTERN.test(object.requestId) &&
      typeof key === 'string' &&
      (NAMED_KEYS.has(key) || (/^[\u0020-\u007e]$/u.test(key) && key !== '`'))
      ? (object as unknown as KeyInput)
      : undefined;
  }
  return undefined;
}

export function createKemerBetSessionProvisionServer(
  dependencies: KemerBetProvisionServerDependencies = {},
): {
  readonly close: () => Promise<void>;
  readonly listen: () => Promise<void>;
  readonly server: Server;
} {
  const effectiveUserId =
    dependencies.effectiveUserId ??
    (typeof process.geteuid === 'function' ? process.geteuid() : Number.NaN);
  assertEnvironment(dependencies.environment ?? process.env, effectiveUserId);
  const launch =
    dependencies.launchPersistentContext ?? chromium.launchPersistentContext.bind(chromium);
  const now = dependencies.now ?? (() => new Date());
  const setTimer = dependencies.setTimer ?? setTimeout;
  const clearTimer = dependencies.clearTimer ?? clearTimeout;
  const createReadinessProbeFromPage =
    dependencies.createReadinessProbeFromPage ?? createKemerBetNoTransferReadinessSealProbeFromPage;
  const runReadinessSeal = dependencies.runReadinessSeal ?? runKemerBetNoTransferReadinessSeal;
  const checkpointSignedInPage =
    dependencies.checkpointSignedInPage ??
    ((input: KemerBetSessionCheckpointInput) =>
      checkpointKemerBetProvisionSignedInPage({ ...input, effectiveUserId }));
  const log =
    dependencies.log ??
    ((event: 'started' | 'signed_in' | 'stopped') =>
      console.info({ component: 'kemerbet_session_provision', event, detailsRedacted: true }));
  const logReadinessSealFailure =
    dependencies.logReadinessSealFailure ??
    ((event: KemerBetReadinessSealFailureEvent) => console.error(JSON.stringify(event)));
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let accountId: string | undefined;
  let expiresAt: Date | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let signedInLogged = false;
  let checkpointedForRecheck = false;
  let blockedRequestCounter = 0n;
  let checkpointValidationActive = false;
  let checkpointBlockedForRecheck = false;
  const readinessFailure = createKemerBetReadinessSealFailureTracker();
  let lane = Promise.resolve();
  const startupProfilesCleaned = new Set<string>();

  const serialized = async <T>(operation: () => Promise<T>): Promise<T> => {
    const result = lane.then(operation, operation);
    lane = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const stop = async (): Promise<void> => {
    if (expiryTimer !== undefined) clearTimer(expiryTimer);
    expiryTimer = undefined;
    const activeContext = context;
    context = undefined;
    page = undefined;
    accountId = undefined;
    expiresAt = undefined;
    signedInLogged = false;
    if (activeContext) {
      await activeContext.close().catch(() => undefined);
      log('stopped');
    }
  };

  const armExpiry = (lifetimeMs: number): void => {
    if (expiryTimer !== undefined) clearTimer(expiryTimer);
    expiresAt = new Date(now().getTime() + lifetimeMs);
    expiryTimer = setTimer(() => void serialized(stop), lifetimeMs);
  };

  const status = async (): Promise<KemerBetProvisionSessionStatus> => {
    if (!context || !page || !accountId || !expiresAt) {
      return { active: false, loginRequired: false, signedIn: false, transferDisabled: true };
    }
    if (now().getTime() >= expiresAt.getTime()) {
      await stop();
      return { active: false, loginRequired: false, signedIn: false, transferDisabled: true };
    }
    const state = validPageUrl(page.url());
    if (!state) return unavailable();
    const signedIn = state === 'agents';
    if (signedIn && !signedInLogged) {
      // The ten-minute deadline protects credential entry only. Once KemerBet confirms
      // authentication, keep this exact locked browser context alive so an Owner-page
      // re-authentication does not discard KemerBet's in-memory authenticated state.
      armExpiry(AUTHENTICATED_SESSION_LIFETIME_MS);
      signedInLogged = true;
      log('signed_in');
    }
    const image = await page.screenshot({ animations: 'disabled', quality: 70, type: 'jpeg' });
    return {
      active: true,
      expiresAt: expiresAt.toISOString(),
      imageBase64: image.toString('base64'),
      imageContentType: 'image/jpeg',
      loginRequired: state === 'login',
      signedIn,
      transferDisabled: true,
    };
  };

  const start = async (input: StartInput): Promise<KemerBetProvisionSessionStatus> => {
    if (checkpointedForRecheck || context || page || accountId || expiresAt) return unavailable();
    await (
      dependencies.assertBrowserExecutable ??
      (() => assertKemerBetBrowserExecutable({ executablePath: CHROMIUM_PATH }))
    )();
    const profile = await prepareProfile(input.platformAgentAccountId, effectiveUserId);
    if (!startupProfilesCleaned.has(profile)) {
      await removeStaleChromiumSingletonArtifacts(profile);
      await assertSafeDirectory(profile, effectiveUserId);
      await assertSafeDirectory(PROFILE_ROOT, effectiveUserId);
      startupProfilesCleaned.add(profile);
    }
    let nextContext: BrowserContext | undefined;
    let nextPage: Page | undefined;
    try {
      nextContext = await launch(profile, {
        acceptDownloads: false,
        bypassCSP: false,
        // This browser runs inside the dedicated non-root Compose sandbox (read-only root,
        // every Linux capability dropped, no-new-privileges, and an isolated network). The
        // Chromium setuid/user-namespace sandbox cannot initialize under that exact boundary;
        // asking Playwright to enable it makes the private sign-in browser fail before the
        // KemerBet login page opens. Keep the outer container sandbox and do not request the
        // incompatible nested Chromium sandbox.
        chromiumSandbox: false,
        executablePath: CHROMIUM_PATH,
        headless: true,
        ignoreHTTPSErrors: false,
        serviceWorkers: 'block',
        viewport: VIEWPORT,
      });
      const pages = nextContext.pages();
      nextPage =
        pages.length === 1
          ? pages[0]
          : pages.length === 0
            ? await nextContext.newPage()
            : undefined;
      if (!nextPage) return unavailable();
      await nextPage.route('**/*', (route) =>
        guardedRoute(route, nextPage as Page, () => {
          blockedRequestCounter += 1n;
          if (checkpointValidationActive) checkpointBlockedForRecheck = true;
        }),
      );
      await nextPage.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      if (validPageUrl(nextPage.url()) === undefined) return unavailable();
    } catch {
      await nextContext?.close().catch(() => undefined);
      return unavailable();
    }
    if (!nextContext || !nextPage) return unavailable();
    context = nextContext;
    page = nextPage;
    accountId = input.platformAgentAccountId;
    checkpointBlockedForRecheck = false;
    armExpiry(LOGIN_LIFETIME_MS);
    log('started');
    return status();
  };

  const checkpointForRecheck = async (): Promise<KemerBetProvisionCheckpointResult> => {
    const currentStatus = await status();
    if (
      checkpointedForRecheck ||
      checkpointBlockedForRecheck ||
      !currentStatus.signedIn ||
      !context ||
      !page ||
      !accountId ||
      !expiresAt ||
      !signedInLogged ||
      now().getTime() >= expiresAt.getTime() ||
      validPageUrl(page.url()) !== 'agents'
    ) {
      return unavailable();
    }
    const retainedContext = context;
    const retainedPage = page;
    const retainedAccountId = accountId;
    const retainedExpiresAt = expiresAt;
    const blockedRequestBaseline = blockedRequestCounter;
    checkpointValidationActive = true;
    try {
      await checkpointSignedInPage({
        accountId: retainedAccountId,
        context: retainedContext,
        page: retainedPage,
      });
      if (
        context !== retainedContext ||
        page !== retainedPage ||
        accountId !== retainedAccountId ||
        expiresAt !== retainedExpiresAt ||
        blockedRequestCounter !== blockedRequestBaseline ||
        checkpointBlockedForRecheck ||
        validPageUrl(retainedPage.url()) !== 'agents'
      ) {
        return unavailable();
      }
      requireExactCheckpointTopology({
        accountId: retainedAccountId,
        context: retainedContext,
        page: retainedPage,
      });

      // Install the irreversible in-process latch before awaiting Chromium shutdown. A failed
      // close cannot reopen input or let a different session race the helper's profile copy.
      checkpointedForRecheck = true;
      await retainedContext.close();
      if (
        context !== retainedContext ||
        page !== retainedPage ||
        accountId !== retainedAccountId ||
        expiresAt !== retainedExpiresAt ||
        blockedRequestCounter !== blockedRequestBaseline ||
        checkpointBlockedForRecheck
      ) {
        return unavailable();
      }
      if (expiryTimer !== undefined) clearTimer(expiryTimer);
      expiryTimer = undefined;
      context = undefined;
      page = undefined;
      accountId = undefined;
      expiresAt = undefined;
      signedInLogged = false;
      log('stopped');
      return {
        checkpointed: true,
        providerSessionFresh: true,
        transferDisabled: true,
        moneyMoved: false,
        identifiersRedacted: true,
      };
    } finally {
      checkpointValidationActive = false;
    }
  };

  const input = async (candidate: SessionInput): Promise<KemerBetProvisionSessionStatus> => {
    if (!context || !page || !accountId || !expiresAt || validPageUrl(page.url()) !== 'login') {
      return unavailable();
    }
    if (candidate.kind === 'pointer') {
      await page.mouse.click(candidate.x, candidate.y);
    } else if (NAMED_KEYS.has(candidate.key)) {
      await page.keyboard.press(candidate.key);
    } else {
      await page.keyboard.insertText(candidate.key);
    }
    await page.waitForTimeout(120);
    return status();
  };

  const sealReadiness = async (): Promise<{
    readonly currency: 'ETB';
    readonly identifiersRedacted: true;
    readonly moneyMoved: false;
    readonly playersChecked: 5;
    readonly sealed: true;
    readonly transferDisabled: true;
  }> => {
    readinessFailure.begin();
    const currentStatus = await status();
    if (
      !currentStatus.signedIn ||
      !signedInLogged ||
      !context ||
      !page ||
      !accountId ||
      !expiresAt ||
      validPageUrl(page.url()) !== 'agents'
    ) {
      return unavailable();
    }
    const retainedContext = context;
    const retainedPage = page;
    const retainedAccountId = accountId;
    const retainedExpiresAt = expiresAt;
    let retainedContextClosed = false;
    // This private manual sign-in/seal lane is an explicitly trusted supervised enrollment
    // ceremony, not a compromised-renderer confidentiality boundary: Chromium and trusted Node
    // share UID 10001 while seal-only inputs are mounted. Containment begins only after this exact
    // context is terminally closed and the retained enrollment state below is cleared.
    const closeRetainedContextForSeal = async (): Promise<void> => {
      if (retainedContextClosed) return;
      if (
        context !== retainedContext ||
        page !== retainedPage ||
        accountId !== retainedAccountId ||
        expiresAt !== retainedExpiresAt
      ) {
        return unavailable();
      }
      // Keep the terminal request latch installed through the awaited Chromium shutdown. Only a
      // confirmed close may make the same-UID provision lane inactive before the seal file is
      // installed; a close failure propagates and therefore emits no binding.
      await retainedContext.close();
      if (
        context !== retainedContext ||
        page !== retainedPage ||
        accountId !== retainedAccountId ||
        expiresAt !== retainedExpiresAt
      ) {
        return unavailable();
      }
      if (expiryTimer !== undefined) clearTimer(expiryTimer);
      expiryTimer = undefined;
      context = undefined;
      page = undefined;
      accountId = undefined;
      expiresAt = undefined;
      signedInLogged = false;
      retainedContextClosed = true;
      log('stopped');
    };
    await runReadinessSeal({
      environment: {
        NODE_ENV: 'production',
        FINANCIAL_ACTIONS_MODE: 'dry_run',
        KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED: 'true',
        KEMERBET_AGENT_IDENTITY_BINDING_ACCOUNT_ID: retainedAccountId,
        KEMERBET_EXECUTOR_ENABLED: 'false',
        KEMERBET_FINAL_ACTION_ENABLED: 'false',
        KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED: 'false',
        INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED: 'false',
      },
      effectiveUserId,
      assertBrowserExecutable: async () => undefined,
      reportStage: readinessFailure.reportStage,
      reportForbiddenRequest: readinessFailure.reportForbiddenRequest,
      openProbe: async (options) => {
        if (
          options.accountId !== retainedAccountId ||
          context !== retainedContext ||
          page !== retainedPage ||
          accountId !== retainedAccountId ||
          expiresAt !== retainedExpiresAt ||
          validPageUrl(retainedPage.url()) !== 'agents'
        ) {
          return unavailable();
        }
        return createReadinessProbeFromPage({
          accountId: retainedAccountId,
          close: closeRetainedContextForSeal,
          fingerprintAgentIdentity: options.fingerprintAgentIdentity,
          page: retainedPage,
          reportForbiddenRequest: options.reportForbiddenRequest,
          reportStage: options.reportStage,
          selectorContract: options.selectorContract,
        });
      },
    });
    if (
      !retainedContextClosed ||
      context !== undefined ||
      page !== undefined ||
      accountId !== undefined ||
      expiresAt !== undefined ||
      expiryTimer !== undefined ||
      signedInLogged
    ) {
      return unavailable();
    }
    readinessFailure.clear();
    return {
      sealed: true,
      playersChecked: 5,
      currency: 'ETB',
      transferDisabled: true,
      moneyMoved: false,
      identifiersRedacted: true,
    };
  };

  const server = createServer((request, response) => {
    void serialized(async () => {
      try {
        if (request.url === '/healthz' && request.method === 'GET') {
          sendJson(response, 200, { status: 'ok', service: 'kemerbet-session-provision' });
          return;
        }
        if (request.url === '/v1/session' && request.method === 'GET') {
          sendJson(response, 200, await status());
          return;
        }
        if (request.url === '/v1/session/start' && request.method === 'POST') {
          const candidate = validStartInput(await readJson(request));
          if (!candidate) return unavailable();
          sendJson(response, 201, await start(candidate));
          return;
        }
        if (request.url === '/v1/session/input' && request.method === 'POST') {
          const candidate = validSessionInput(await readJson(request));
          if (!candidate) return unavailable();
          sendJson(response, 200, await input(candidate));
          return;
        }
        if (request.url === '/v1/session/checkpoint' && request.method === 'POST') {
          const candidate = validReadinessSealInput(await readJson(request));
          if (!candidate) return unavailable();
          sendJson(response, 201, await checkpointForRecheck());
          return;
        }
        if (request.url === '/v1/readiness/seal' && request.method === 'POST') {
          const candidate = validReadinessSealInput(await readJson(request));
          if (!candidate) return unavailable();
          sendJson(response, 201, await sealReadiness());
          return;
        }
        if (request.url === '/v1/session/stop' && request.method === 'POST') {
          const object = exactObject(await readJson(request), ['requestId']);
          if (typeof object?.requestId !== 'string' || !REQUEST_ID_PATTERN.test(object.requestId)) {
            return unavailable();
          }
          await stop();
          sendJson(response, 200, await status());
          return;
        }
        sendJson(response, 404, { error: 'not_found' });
      } catch {
        const readinessSealRequest =
          request.url === '/v1/readiness/seal' && request.method === 'POST';
        const failure = readinessSealRequest ? readinessFailure.consume() : undefined;
        if (!readinessSealRequest) readinessFailure.clear();
        const failureStage = failure?.stage;
        const failureForbiddenRequest = failure?.forbiddenRequest;
        if (readinessSealRequest) {
          try {
            logReadinessSealFailure(
              createKemerBetReadinessSealFailureEvent(failureStage, failureForbiddenRequest),
            );
          } catch {
            // Diagnostics must never replace the existing fail-closed response or expose the error.
          }
        }
        if (!response.headersSent) {
          sendJson(
            response,
            503,
            failureStage === undefined
              ? { error: 'session_unavailable' }
              : { error: 'session_unavailable', stage: failureStage },
          );
        } else response.destroy();
      }
    });
  });

  return {
    server,
    listen: async () => {
      await assertSafeDirectory(CONTROL_ROOT, effectiveUserId);
      await rm(CONTROL_SOCKET, { force: true });
      await new Promise<void>((resolvePromise, reject) => {
        server.once('error', reject);
        server.listen(CONTROL_SOCKET, () => {
          server.off('error', reject);
          resolvePromise();
        });
      });
      await chmod(CONTROL_SOCKET, 0o600);
      const socketStat = (await lstat(CONTROL_SOCKET)) as SafeStat;
      if (
        socketStat.isSymbolicLink() ||
        socketStat.uid !== effectiveUserId ||
        (socketStat.mode & 0o777) !== 0o600
      ) {
        await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
        await rm(CONTROL_SOCKET, { force: true });
        unavailable();
      }
    },
    close: async () => {
      await serialized(stop);
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
      await rm(CONTROL_SOCKET, { force: true });
    },
  };
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  const provisionServer = createKemerBetSessionProvisionServer();
  const close = async () => {
    await provisionServer.close();
  };
  process.once('SIGINT', () => void close());
  process.once('SIGTERM', () => void close());
  await provisionServer.listen();
  console.info({ component: 'kemerbet_session_provision', event: 'listening' });
}
