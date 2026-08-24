import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, open, realpath, unlink } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  KEMERBET_AGENT_IDENTITY_HMAC_KEY_FILE,
  KEMERBET_AGENT_PROFILES_ROOT,
  KEMERBET_BROWSER_EXECUTABLE_PATH,
  KEMERBET_NO_TRANSFER_READINESS_PLAYER_IDS_FILE,
  KEMERBET_SELECTOR_CONTRACT_FILE,
} from '@fetanagent/config/executor';
import {
  chromium,
  type BrowserContext,
  type Page,
  type Route,
  type WebSocketRoute,
} from 'playwright-core';

import {
  assertKemerBetBrowserExecutable,
  loadKemerBetNoTransferReadinessPlayerIds,
  loadKemerBetSelectorContract,
  type KemerBetNoTransferReadinessPlayers,
} from './executor-runtime-isolation.js';
import {
  createKemerBetAgentIdentityFingerprinter,
  type KemerBetAgentIdentityFingerprinter,
} from './kemerbet-agent-identity-fingerprint.js';
import { removeStaleChromiumSingletonArtifacts } from './kemerbet-chromium-profile.js';
import {
  assertKemerBetAgentPageSelectorContractV2,
  createPlaywrightKemerBetAgentPage,
  KEMERBET_AGENT_API_ORIGIN,
  KEMERBET_AGENT_DEPOSIT_URL,
  KEMERBET_AGENT_PLAYER_DEPOSIT_PATH,
  KEMERBET_AGENT_PLAYER_LOOKUP_PATH,
  observeKemerBetAgentIdentityFingerprint,
  type KemerBetAgentIdentityObservationStage,
  type KemerBetAgentPageSelectorContractV2,
} from './playwright-kemerbet-agent-page.js';

const OUTPUT_ROOT = '/run/fetanagent-kemerbet-readiness-seal-output';
const OUTPUT_FILE = `${OUTPUT_ROOT}/kemerbet_agent_identity_bindings`;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const FINGERPRINT_PATTERN = /^hmac-sha256-agent-identity-v1:[0-9a-f]{64}$/u;
const PLAYER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const KEMERBET_LOOKUP_PREFLIGHT_REQUEST_HEADERS = new Set(['authorization', 'content-type']);
const KEMERBET_AGENT_API_HOSTNAME = new URL(KEMERBET_AGENT_API_ORIGIN).hostname;
const KEMERBET_AGENT_WEB_HOSTNAME = new URL(KEMERBET_AGENT_DEPOSIT_URL).hostname;
const KEMERBET_AGENT_BOOTSTRAP_ORIGIN = 'https://agt-client-akm.agent-digi.com';
const KEMERBET_AGENT_BOOTSTRAP_ASSETS = new Map<string, 'script' | 'stylesheet'>([
  ['/prd/agt-admin-client/v84/index-BUEO7OSf.js', 'script'],
  ['/prd/agt-admin-client/v84/index-BnOqIDsD.css', 'stylesheet'],
  ['/prd/agt-admin-client/v84/_ltrOffset-C2RQMwco.css', 'stylesheet'],
  ['/prd/agt-admin-client/v84/ltr-v1RhStcA.js', 'script'],
  ['/prd/agt-admin-client/v84/ltr-v3JyGz8d.js', 'script'],
  ['/prd/agt-admin-client/v84/index-Bi1Y1r_Z.js', 'script'],
  ['/prd/agt-admin-client/v84/index-6dvVbeUF.js', 'script'],
]);
const KEMERBET_OPTIONAL_BOOTSTRAP_ASSETS = new Map<string, 'font' | 'image'>([
  [
    'https://agt-cdn.cdn-digi.com/prd/companies/2093/projects/39803/logo_24e4a06149154c9a956062027baa2fed.png',
    'image',
  ],
  ['https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v84/auth-bg-Dn8uzDgY.svg', 'image'],
  [
    'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v84/icomoon-BzeA2iFa.ttf?squmb1',
    'font',
  ],
  [
    'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v84/icomoon-CIUf9UuY.eot?squmb1',
    'font',
  ],
  [
    'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v84/icomoon-CTmSmUzv.woff?squmb1',
    'font',
  ],
  [
    'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v84/icomoon-DYzGJZDb.svg?squmb1',
    'image',
  ],
]);
const RECAPTCHA_HOSTNAMES = new Set(['www.google.com', 'www.recaptcha.net']);
const KEMERBET_AGENT_REFRESH_TOKEN_PATH = '/Account/RefreshToken';
const SENTRY_ENVELOPE_HOSTNAME = 'send.sentry.report';
const SENTRY_ENVELOPE_PATH = '/api/306/envelope/';
const HOTJAR_TELEMETRY_HOSTNAMES = new Set([
  't.cs.hotjar.io',
  'insights.hotjar.com',
  'metrics.hotjar.io',
  'script.hotjar.com',
  'static.hotjar.com',
]);
const DISALLOWED_ENVIRONMENT_KEYS = [
  'KEMERBET_EXECUTOR_DATABASE_URL',
  'KEMERBET_EXECUTOR_DATABASE_URL_FILE',
  'KEMERBET_AGENT_IDENTITY_BINDINGS_FILE',
  'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_MANIFEST_FILE',
  'KEMERBET_HISTORY_REFERENCE_HMAC_KEY_FILE',
] as const;

export type KemerBetNoTransferReadinessSealStage =
  | 'environment_guard'
  | 'readiness_inputs'
  | 'signed_in_page'
  | 'route_guard'
  | 'agent_identity'
  | 'agent_session_guard'
  | 'agent_identity_marker'
  | 'agent_identity_value'
  | 'agent_identity_stability'
  | 'page_adoption'
  | 'lookup_surface'
  | 'lookup_request'
  | 'lookup_input'
  | 'lookup_input_blurred'
  | 'lookup_action'
  | 'lookup_click_actionability'
  | 'lookup_native_click'
  | 'lookup_response'
  | 'lookup_network_request'
  | 'forbidden_request'
  | 'lookup_contract'
  | 'lookup_result'
  | 'lookup_reset'
  | 'final_guard'
  | 'binding_write';

export type KemerBetReadinessSealForbiddenRequestReason =
  | 'exact_financial_endpoint'
  | 'exact_auth_session_endpoint'
  | 'non_read_method'
  | 'noncanonical_navigation'
  | 'non_https'
  | 'url_credentials'
  | 'explicit_port'
  | 'fragment'
  | 'malformed_url';

export type KemerBetReadinessSealForbiddenRequestTarget =
  | 'agent_api'
  | 'agent_auth_session'
  | 'agent_web'
  | 'known_telemetry'
  | 'recaptcha'
  | 'third_party'
  | 'unparseable';

export type KemerBetReadinessSealForbiddenRequestMethod =
  'GET' | 'HEAD' | 'OPTIONS' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OTHER';

export type KemerBetReadinessSealForbiddenRequestKind =
  'main_navigation' | 'subframe_navigation' | 'subresource';

export interface KemerBetReadinessSealForbiddenRequestDiagnostic {
  readonly reason: KemerBetReadinessSealForbiddenRequestReason;
  readonly target: KemerBetReadinessSealForbiddenRequestTarget;
  readonly method: KemerBetReadinessSealForbiddenRequestMethod;
  readonly kind: KemerBetReadinessSealForbiddenRequestKind;
}

export type KemerBetReadinessSealRequestClassification =
  | { readonly decision: 'allow' }
  | {
      readonly decision: 'abort_optional';
      readonly target: 'first_party_read' | 'known_telemetry' | 'optional_static' | 'recaptcha';
    }
  | {
      readonly decision: 'forbid';
      readonly diagnostic: KemerBetReadinessSealForbiddenRequestDiagnostic;
    };

interface SafeStat {
  readonly mode: number;
  readonly uid: number;
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface KemerBetNoTransferReadinessSealProbe {
  readonly observedAgentIdentityFingerprint: string;
  probePlayerLookup(target: { readonly playerId: string; readonly currencyCode: 'ETB' }): Promise<{
    readonly exactPlayerMatch: true;
    readonly exactCurrencyMatch: true;
    readonly transferDisabled: true;
  } | null>;
  /** Drain the proof route, stop its browser ownership, and reject any forbidden request attempt. */
  finalizeReadOnlyProof(): Promise<void>;
  close(): Promise<void>;
}

export interface KemerBetNoTransferReadinessSealDependencies {
  readonly environment?: NodeJS.ProcessEnv;
  readonly effectiveUserId?: number;
  readonly assertBrowserExecutable?: () => Promise<void>;
  readonly loadPlayerIds?: () => Promise<KemerBetNoTransferReadinessPlayers>;
  readonly loadSelectorContract?: () => Promise<KemerBetAgentPageSelectorContractV2>;
  readonly createAgentIdentityFingerprinter?: () => Promise<KemerBetAgentIdentityFingerprinter>;
  readonly openProbe?: (options: {
    readonly accountId: string;
    readonly selectorContract: KemerBetAgentPageSelectorContractV2;
    readonly fingerprintAgentIdentity: KemerBetAgentIdentityFingerprinter;
    readonly effectiveUserId: number;
    readonly reportStage: (stage: KemerBetNoTransferReadinessSealStage) => void;
    readonly reportForbiddenRequest: (
      diagnostic: KemerBetReadinessSealForbiddenRequestDiagnostic,
    ) => void;
  }) => Promise<KemerBetNoTransferReadinessSealProbe>;
  readonly writeBinding?: (
    accountId: string,
    fingerprint: string,
    effectiveUserId: number,
  ) => Promise<void>;
  readonly logSuccess?: (result: {
    readonly component: 'kemerbet_no_transfer_readiness_seal';
    readonly event: 'sealed';
    readonly accountsBound: 1;
    readonly playersChecked: 5;
    readonly currency: 'ETB';
    readonly transferDisabled: true;
    readonly identifiersRedacted: true;
    readonly moneyMoved: false;
  }) => void;
  readonly reportStage?: (stage: KemerBetNoTransferReadinessSealStage) => void;
  readonly reportForbiddenRequest?: (
    diagnostic: KemerBetReadinessSealForbiddenRequestDiagnostic,
  ) => void;
}

export class KemerBetNoTransferReadinessSealUnavailableError extends Error {
  constructor() {
    super('The KemerBet no-transfer readiness seal boundary is unavailable.');
    this.name = 'KemerBetNoTransferReadinessSealUnavailableError';
  }
}

function unavailable(): never {
  throw new KemerBetNoTransferReadinessSealUnavailableError();
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'ENOENT'
  );
}

function canonicalAccountId(value: string | undefined): string {
  if (
    value === undefined ||
    !UUID_PATTERN.test(value) ||
    value === '00000000-0000-0000-0000-000000000000'
  ) {
    return unavailable();
  }
  return value;
}

function assertInertEnvironment(environment: NodeJS.ProcessEnv): string {
  if (
    environment.NODE_ENV !== 'production' ||
    environment.FINANCIAL_ACTIONS_MODE !== 'dry_run' ||
    environment.KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED !== 'true' ||
    environment.KEMERBET_EXECUTOR_ENABLED !== 'false' ||
    environment.KEMERBET_FINAL_ACTION_ENABLED !== 'false' ||
    environment.KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED !== 'false' ||
    environment.INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED !== 'false' ||
    DISALLOWED_ENVIRONMENT_KEYS.some((key) => environment[key] !== undefined)
  ) {
    return unavailable();
  }
  return canonicalAccountId(environment.KEMERBET_AGENT_IDENTITY_BINDING_ACCOUNT_ID);
}

function validateSelectorContract(value: unknown): KemerBetAgentPageSelectorContractV2 {
  assertKemerBetAgentPageSelectorContractV2(value);
  return value;
}

function sameMetadata(left: SafeStat, right: SafeStat): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.uid === right.uid
  );
}

async function assertSafeDirectory(
  path: string,
  effectiveUserId: number,
  exactMode?: number,
): Promise<void> {
  const before = (await lstat(path)) as SafeStat;
  if (
    !before.isDirectory() ||
    before.isSymbolicLink() ||
    (before.uid !== 0 && before.uid !== effectiveUserId) ||
    (exactMode === undefined ? (before.mode & 0o022) !== 0 : (before.mode & 0o777) !== exactMode) ||
    (await realpath(path)) !== path
  ) {
    unavailable();
  }
  const after = (await lstat(path)) as SafeStat;
  if (!after.isDirectory() || after.isSymbolicLink() || !sameMetadata(before, after)) unavailable();
}

async function resolveSafeProfile(accountId: string, effectiveUserId: number): Promise<string> {
  const profilesRoot = resolve(KEMERBET_AGENT_PROFILES_ROOT);
  const profile = resolve(profilesRoot, accountId);
  if (
    profile !== `${profilesRoot}/${accountId}` ||
    relative(profilesRoot, profile) !== accountId ||
    dirname(profile) !== profilesRoot
  ) {
    return unavailable();
  }
  await assertSafeDirectory(profilesRoot, effectiveUserId);
  await assertSafeDirectory(profile, effectiveUserId, 0o700);
  return profile;
}

function fixedRequestMethod(method: string): KemerBetReadinessSealForbiddenRequestMethod {
  switch (method) {
    case 'GET':
    case 'HEAD':
    case 'OPTIONS':
    case 'POST':
    case 'PUT':
    case 'PATCH':
    case 'DELETE':
      return method;
    default:
      return 'OTHER';
  }
}

function requestKind(input: {
  readonly isMainFrame: boolean;
  readonly isNavigationRequest: boolean;
}): KemerBetReadinessSealForbiddenRequestKind {
  if (input.isNavigationRequest) {
    return input.isMainFrame ? 'main_navigation' : 'subframe_navigation';
  }
  return 'subresource';
}

function requestTarget(url: URL): KemerBetReadinessSealForbiddenRequestTarget {
  if (url.hostname === KEMERBET_AGENT_API_HOSTNAME) {
    return url.pathname === KEMERBET_AGENT_REFRESH_TOKEN_PATH ? 'agent_auth_session' : 'agent_api';
  }
  if (url.hostname === KEMERBET_AGENT_WEB_HOSTNAME) return 'agent_web';
  if (
    (url.hostname === SENTRY_ENVELOPE_HOSTNAME && url.pathname === SENTRY_ENVELOPE_PATH) ||
    HOTJAR_TELEMETRY_HOSTNAMES.has(url.hostname)
  ) {
    return 'known_telemetry';
  }
  if (RECAPTCHA_HOSTNAMES.has(url.hostname)) return 'recaptcha';
  return 'third_party';
}

function forbiddenRequestClassification(
  reason: KemerBetReadinessSealForbiddenRequestReason,
  target: KemerBetReadinessSealForbiddenRequestTarget,
  method: KemerBetReadinessSealForbiddenRequestMethod,
  kind: KemerBetReadinessSealForbiddenRequestKind,
): KemerBetReadinessSealRequestClassification {
  return Object.freeze({
    decision: 'forbid',
    diagnostic: Object.freeze({ reason, target, method, kind }),
  });
}

function optionalRequestClassification(
  target: 'first_party_read' | 'known_telemetry' | 'optional_static' | 'recaptcha',
): KemerBetReadinessSealRequestClassification {
  return Object.freeze({ decision: 'abort_optional', target });
}

function exactPlayerLookupTransportRequest(input: {
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly method: string;
  readonly expectedPlayerId: string | null;
  readonly url: URL;
}): boolean {
  if ((input.method !== 'GET' && input.method !== 'OPTIONS') || input.expectedPlayerId === null) {
    return false;
  }
  const query = [...input.url.searchParams.entries()];
  const playerId = query[0]?.[1];
  const exactUrl =
    input.url.origin === KEMERBET_AGENT_API_ORIGIN &&
    input.url.pathname === KEMERBET_AGENT_PLAYER_LOOKUP_PATH &&
    query.length === 1 &&
    query[0]?.[0] === 'externalId' &&
    typeof playerId === 'string' &&
    PLAYER_ID_PATTERN.test(playerId) &&
    playerId === input.expectedPlayerId;
  if (!exactUrl || input.method === 'GET') return exactUrl;
  const normalizedHeaders = Object.fromEntries(
    Object.entries(input.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value.trim()]),
  );
  if (
    normalizedHeaders.origin !== new URL(KEMERBET_AGENT_DEPOSIT_URL).origin ||
    normalizedHeaders['access-control-request-method']?.toUpperCase() !== 'GET'
  ) {
    return false;
  }
  const requestedHeaders = (normalizedHeaders['access-control-request-headers'] ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value !== '');
  return (
    requestedHeaders.length >= 1 &&
    new Set(requestedHeaders).size === requestedHeaders.length &&
    requestedHeaders.every((name) => KEMERBET_LOOKUP_PREFLIGHT_REQUEST_HEADERS.has(name))
  );
}

function exactKemerBetBootstrapAsset(input: {
  readonly method: string;
  readonly resourceType: string | undefined;
  readonly url: URL;
}): boolean {
  if (
    input.method !== 'GET' ||
    input.url.origin !== KEMERBET_AGENT_BOOTSTRAP_ORIGIN ||
    input.url.search !== ''
  ) {
    return false;
  }
  const expectedResourceType = KEMERBET_AGENT_BOOTSTRAP_ASSETS.get(input.url.pathname);
  return expectedResourceType !== undefined && input.resourceType === expectedResourceType;
}

function exactLocallyAbortedKemerBetStaticAsset(input: {
  readonly method: string;
  readonly resourceType: string | undefined;
  readonly url: URL;
}): boolean {
  if (input.method !== 'GET') return false;
  return KEMERBET_OPTIONAL_BOOTSTRAP_ASSETS.get(input.url.href) === input.resourceType;
}

function isKemerBetFirstPartyOrigin(url: URL): boolean {
  return (
    url.origin === KEMERBET_AGENT_API_ORIGIN ||
    url.origin === new URL(KEMERBET_AGENT_DEPOSIT_URL).origin ||
    url.origin === KEMERBET_AGENT_BOOTSTRAP_ORIGIN
  );
}

export function classifyKemerBetReadinessSealRequest(input: {
  readonly expectedPlayerId?: string | null;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly isMainFrame: boolean;
  readonly isNavigationRequest: boolean;
  readonly method: string;
  readonly requestUrl: string;
  readonly resourceType?: string | undefined;
}): KemerBetReadinessSealRequestClassification {
  const method = fixedRequestMethod(input.method);
  const kind = requestKind(input);
  let url: URL;
  try {
    url = new URL(input.requestUrl);
  } catch {
    return forbiddenRequestClassification('malformed_url', 'unparseable', method, kind);
  }
  const target = requestTarget(url);
  if (url.protocol !== 'https:') {
    return forbiddenRequestClassification('non_https', target, method, kind);
  }
  if (url.username !== '' || url.password !== '') {
    return forbiddenRequestClassification('url_credentials', target, method, kind);
  }
  if (url.port !== '') {
    return forbiddenRequestClassification('explicit_port', target, method, kind);
  }
  if (url.hash !== '') {
    return forbiddenRequestClassification('fragment', target, method, kind);
  }
  if (target === 'known_telemetry' || target === 'recaptcha') {
    // These exact optional providers are never needed for an already-authenticated five-lookup
    // proof. Abort them locally without transmitting them, but do not invalidate an otherwise
    // complete proof merely because the restored page attempted optional telemetry or CAPTCHA UI.
    return optionalRequestClassification(target);
  }
  if (
    url.origin === KEMERBET_AGENT_API_ORIGIN &&
    url.pathname === KEMERBET_AGENT_REFRESH_TOKEN_PATH
  ) {
    return forbiddenRequestClassification('exact_auth_session_endpoint', target, method, kind);
  }
  if (
    url.origin === KEMERBET_AGENT_API_ORIGIN &&
    (url.pathname === KEMERBET_AGENT_PLAYER_DEPOSIT_PATH ||
      url.pathname.startsWith('/Wallet/') ||
      url.pathname.startsWith('/Transaction/'))
  ) {
    return forbiddenRequestClassification('exact_financial_endpoint', target, method, kind);
  }
  if (!READ_METHODS.has(input.method)) {
    return forbiddenRequestClassification('non_read_method', target, method, kind);
  }
  if (input.isNavigationRequest) {
    if (!input.isMainFrame || input.method !== 'GET' || url.href !== KEMERBET_AGENT_DEPOSIT_URL) {
      return forbiddenRequestClassification('noncanonical_navigation', target, method, kind);
    }
    return Object.freeze({ decision: 'allow' });
  }
  if (
    exactKemerBetBootstrapAsset({
      method: input.method,
      resourceType: input.resourceType,
      url,
    })
  ) {
    return Object.freeze({ decision: 'allow' });
  }
  if (
    target === 'agent_api' &&
    exactPlayerLookupTransportRequest({
      headers: input.headers,
      method: input.method,
      expectedPlayerId: input.expectedPlayerId ?? null,
      url,
    })
  ) {
    return Object.freeze({ decision: 'allow' });
  }
  if (
    exactLocallyAbortedKemerBetStaticAsset({
      method: input.method,
      resourceType: input.resourceType,
      url,
    })
  ) {
    return optionalRequestClassification('optional_static');
  }
  if (READ_METHODS.has(input.method) && isKemerBetFirstPartyOrigin(url)) {
    // Unknown first-party reads are not transmitted and therefore cannot move money or disclose
    // the private Player cohort. They are non-sticky so harmless Account/Agent bootstrap reads do
    // not invalidate a proof when the cached SPA can reach the audited lookup surface without
    // them. Required reads still fail naturally when the audited DOM contract cannot become ready.
    return optionalRequestClassification('first_party_read');
  }
  return forbiddenRequestClassification('noncanonical_navigation', target, method, kind);
}

export function isAllowedKemerBetReadinessSealRequest(input: {
  readonly expectedPlayerId?: string | null;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly isMainFrame: boolean;
  readonly isNavigationRequest: boolean;
  readonly method: string;
  readonly requestUrl: string;
  readonly resourceType?: string | undefined;
}): boolean {
  return classifyKemerBetReadinessSealRequest(input).decision === 'allow';
}

export function isExactKemerBetReadinessSealPlayerLookupRequest(input: {
  readonly expectedPlayerId?: string | null;
  readonly method: string;
  readonly requestUrl: string;
}): boolean {
  if (
    input.method !== 'GET' ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(input.requestUrl) ||
    /%(?![0-9A-Fa-f]{2})/u.test(input.requestUrl)
  ) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(input.requestUrl);
  } catch {
    return false;
  }
  return (
    exactPlayerLookupTransportRequest({
      method: input.method,
      expectedPlayerId: input.expectedPlayerId ?? null,
      url,
    }) &&
    url.username === '' &&
    url.password === '' &&
    url.port === '' &&
    url.hash === ''
  );
}

export interface KemerBetReadinessSealRequestPort {
  frame(): unknown;
  headers?(): Record<string, string>;
  isNavigationRequest(): boolean;
  method(): string;
  resourceType?(): string;
  url(): string;
}

export interface KemerBetReadinessSealRoutePort {
  request(): KemerBetReadinessSealRequestPort;
  abort(errorCode: 'blockedbyclient'): Promise<unknown>;
  continue(): Promise<unknown>;
}

export interface KemerBetReadinessSealPagePort {
  mainFrame(): unknown;
}

export async function guardKemerBetReadinessSealRoute(
  route: KemerBetReadinessSealRoutePort,
  page: KemerBetReadinessSealPagePort,
  reportStage: (stage: KemerBetNoTransferReadinessSealStage) => void,
  expectedPlayerId: string | null = null,
): Promise<void> {
  const request = route.request();
  const classification = classifyKemerBetReadinessSealRequest({
    expectedPlayerId,
    headers: request.headers?.(),
    isMainFrame: request.frame() === page.mainFrame(),
    isNavigationRequest: request.isNavigationRequest(),
    method: request.method(),
    requestUrl: request.url(),
    resourceType: request.resourceType?.(),
  });
  if (classification.decision !== 'allow') {
    await route.abort('blockedbyclient');
    return;
  }
  if (
    isExactKemerBetReadinessSealPlayerLookupRequest({
      expectedPlayerId,
      method: request.method(),
      requestUrl: request.url(),
    })
  ) {
    // Diagnostic only: this fixed stage proves only that a lookup-shaped GET reached the guard.
    // The response contract and later visible result bind the request to the expected Player.
    try {
      reportStage('lookup_network_request');
    } catch {
      // Diagnostic reporting cannot interrupt an otherwise allowed read-only request.
    }
  }
  await route.continue();
}

interface KemerBetNoTransferReadinessRequestBoundary {
  readonly drain: () => Promise<void>;
  readonly install: () => Promise<void>;
  readonly invalid: () => boolean;
  readonly remove: () => Promise<void>;
  readonly withExpectedPlayerLookup: <T>(playerId: string, action: () => Promise<T>) => Promise<T>;
}

function createKemerBetNoTransferReadinessRequestBoundary(options: {
  readonly externalBoundaryInvalid?: (() => boolean) | undefined;
  readonly installRoute: (handler: (route: Route) => Promise<void>) => Promise<void>;
  readonly page: () => Page | null;
  readonly removeRoute: (handler: (route: Route) => Promise<void>) => Promise<void>;
  readonly reportForbiddenRequest?:
    ((diagnostic: KemerBetReadinessSealForbiddenRequestDiagnostic) => void) | undefined;
  readonly reportStage: (stage: KemerBetNoTransferReadinessSealStage) => void;
}): KemerBetNoTransferReadinessRequestBoundary {
  let activeExpectedPlayerId: string | null = null;
  let forbiddenRequestObserved = false;
  let firstForbiddenRequest: KemerBetReadinessSealForbiddenRequestDiagnostic | undefined;
  let routeHandlerFailureObserved = false;
  let installed = false;
  const operations = new Set<Promise<void>>();
  const externalBoundaryInvalid = (): boolean => {
    try {
      return options.externalBoundaryInvalid?.() === true;
    } catch {
      return true;
    }
  };
  const invalid = (): boolean =>
    forbiddenRequestObserved || routeHandlerFailureObserved || externalBoundaryInvalid();
  const routeHandler = (route: Route): Promise<void> => {
    const operation = (async () => {
      const page = options.page();
      if (page === null) {
        routeHandlerFailureObserved = true;
        await route.abort('blockedbyclient');
        return;
      }
      const request = route.request();
      const expectedPlayerId = activeExpectedPlayerId;
      const classification = classifyKemerBetReadinessSealRequest({
        expectedPlayerId,
        headers: request.headers(),
        isMainFrame: request.frame() === page.mainFrame(),
        isNavigationRequest: request.isNavigationRequest(),
        method: request.method(),
        requestUrl: request.url(),
        resourceType: request.resourceType(),
      });
      if (classification.decision === 'forbid') {
        forbiddenRequestObserved = true;
        if (firstForbiddenRequest === undefined) {
          firstForbiddenRequest = classification.diagnostic;
          try {
            options.reportForbiddenRequest?.(classification.diagnostic);
          } catch {
            // Fixed diagnostics cannot weaken the already-sticky request boundary.
          }
        }
        try {
          options.reportStage('forbidden_request');
        } catch {
          // A diagnostic callback cannot prevent the explicit abort below.
        }
      }
      await guardKemerBetReadinessSealRoute(route, page, options.reportStage, expectedPlayerId);
    })();
    operations.add(operation);
    void operation.then(
      () => operations.delete(operation),
      () => {
        operations.delete(operation);
        routeHandlerFailureObserved = true;
      },
    );
    return operation;
  };
  return {
    async drain() {
      while (operations.size > 0) await Promise.allSettled([...operations]);
    },
    async install() {
      if (installed) return unavailable();
      await options.installRoute(routeHandler);
      installed = true;
    },
    invalid,
    async remove() {
      if (!installed) return;
      await options.removeRoute(routeHandler);
      installed = false;
      while (operations.size > 0) await Promise.allSettled([...operations]);
    },
    async withExpectedPlayerLookup(playerId, action) {
      if (!PLAYER_ID_PATTERN.test(playerId) || activeExpectedPlayerId !== null || invalid()) {
        return unavailable();
      }
      activeExpectedPlayerId = playerId;
      try {
        return await action();
      } finally {
        activeExpectedPlayerId = null;
      }
    },
  };
}

interface KemerBetNoTransferReadinessGuardedProbeFromPageOptions {
  readonly accountId: string;
  readonly close: () => Promise<void>;
  readonly externalBoundaryInvalid?: () => boolean;
  readonly fingerprintAgentIdentity: KemerBetAgentIdentityFingerprinter;
  readonly page: Page;
  readonly requestBoundary?: KemerBetNoTransferReadinessRequestBoundary;
  readonly reportForbiddenRequest?: (
    diagnostic: KemerBetReadinessSealForbiddenRequestDiagnostic,
  ) => void;
  readonly reportStage?: (stage: KemerBetNoTransferReadinessSealStage) => void;
  readonly selectorContract: KemerBetAgentPageSelectorContractV2;
  readonly startup:
    | { readonly mode: 'adopt_authenticated_page' }
    | {
        readonly mode: 'offline_canonical_navigation';
        readonly setOnline: () => Promise<void>;
      };
}

async function createKemerBetNoTransferReadinessGuardedProbeFromPage(
  options: KemerBetNoTransferReadinessGuardedProbeFromPageOptions,
): Promise<KemerBetNoTransferReadinessSealProbe> {
  const reportStage = options.reportStage ?? (() => undefined);
  const requestBoundary =
    options.requestBoundary ??
    createKemerBetNoTransferReadinessRequestBoundary({
      externalBoundaryInvalid: options.externalBoundaryInvalid,
      installRoute: async (handler) => {
        await options.page.route('**/*', handler);
      },
      page: () => options.page,
      removeRoute: async (handler) => {
        await options.page.unroute('**/*', handler);
      },
      reportForbiddenRequest: options.reportForbiddenRequest,
      reportStage,
    });
  const ownsRequestBoundary = options.requestBoundary === undefined;
  let probeReturned = false;
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    if (options.startup.mode === 'offline_canonical_navigation') {
      // Never unroute a persistent browser. If context closure fails, propagate while the
      // context-wide guards remain installed until a later close retry or container death.
      await options.close();
    } else {
      await requestBoundary.remove().catch(() => undefined);
      await options.close();
    }
    closed = true;
  };
  try {
    reportStage('route_guard');
    const expectedStartupUrl =
      options.startup.mode === 'adopt_authenticated_page'
        ? KEMERBET_AGENT_DEPOSIT_URL
        : 'about:blank';
    if (options.page.url() !== expectedStartupUrl) unavailable();
    if (ownsRequestBoundary) await requestBoundary.install();
    if (options.page.url() !== expectedStartupUrl || requestBoundary.invalid()) unavailable();
    if (options.startup.mode === 'offline_canonical_navigation') {
      // The persistent context is launched offline. Install the complete HTTP boundary first,
      // then bring it online for exactly one canonical main-frame navigation. No restored page can
      // race a request ahead of the guard.
      await options.startup.setOnline();
      if (requestBoundary.invalid()) unavailable();
      await options.page.goto(KEMERBET_AGENT_DEPOSIT_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
    }
    if (options.page.url() !== KEMERBET_AGENT_DEPOSIT_URL || requestBoundary.invalid()) {
      unavailable();
    }
    reportStage('agent_identity');
    const identityStage = (stage: KemerBetAgentIdentityObservationStage): void => {
      const mapped: Record<
        KemerBetAgentIdentityObservationStage,
        KemerBetNoTransferReadinessSealStage
      > = {
        session_guard: 'agent_session_guard',
        identity_marker: 'agent_identity_marker',
        identity_value: 'agent_identity_value',
        identity_stability: 'agent_identity_stability',
      };
      reportStage(mapped[stage]);
    };
    const observedAgentIdentityFingerprint = await observeKemerBetAgentIdentityFingerprint({
      page: options.page,
      platformAgentAccountId: options.accountId,
      selectorContract: options.selectorContract,
      fingerprintAgentIdentity: options.fingerprintAgentIdentity,
      reportStage: identityStage,
      timeoutMs: 30_000,
    });
    reportStage('page_adoption');
    const agentPage = createPlaywrightKemerBetAgentPage({
      page: options.page,
      platformAgentAccountId: options.accountId,
      sessionKey: `kemerbet-readiness-seal-v1:${options.accountId}`,
      selectorContract: options.selectorContract,
      expectedAgentIdentityFingerprint: observedAgentIdentityFingerprint,
      fingerprintAgentIdentity: options.fingerprintAgentIdentity,
      activateReadOnlyLookupWithGuardedNativeClick: true,
      timeoutMs: 30_000,
      reportLookupStage: (stage) => options.reportStage?.(stage),
    });
    await agentPage.adoptCurrentDepositPageWithoutNavigation();
    probeReturned = true;
    return {
      observedAgentIdentityFingerprint,
      probePlayerLookup: async (target) => {
        if (
          target.currencyCode !== 'ETB' ||
          !PLAYER_ID_PATTERN.test(target.playerId) ||
          requestBoundary.invalid()
        ) {
          unavailable();
        }
        reportStage('lookup_surface');
        await agentPage.openPlayerDeposit();
        if (requestBoundary.invalid()) unavailable();
        reportStage('lookup_request');
        await requestBoundary.withExpectedPlayerLookup(target.playerId, async () => {
          await agentPage.lookupPlayer(target.playerId);
        });
        if (
          requestBoundary.invalid() ||
          (await agentPage.currentUrl()) !== KEMERBET_AGENT_DEPOSIT_URL
        ) {
          unavailable();
        }
        reportStage('lookup_result');
        const lookup = await agentPage.readAgentLookup();
        if (
          requestBoundary.invalid() ||
          lookup.playerId !== target.playerId ||
          lookup.currencyCode !== target.currencyCode
        ) {
          unavailable();
        }
        reportStage('lookup_reset');
        await agentPage.resetReadOnlyPlayerLookup();
        if (requestBoundary.invalid()) unavailable();
        return {
          exactPlayerMatch: true,
          exactCurrencyMatch: true,
          transferDisabled: true,
        };
      },
      finalizeReadOnlyProof: async () => {
        if (closed || requestBoundary.invalid()) unavailable();
        // Let application work causally triggered by the final Find/reset settle while the strict
        // route is still installed, then drain every in-flight route handler before releasing the
        // page. Production closes the context here; the supervised sign-in service retains it under
        // its independent mutation-blocking route.
        await options.page.waitForTimeout(250);
        await requestBoundary.drain();
        if (requestBoundary.invalid()) unavailable();
        if (options.startup.mode === 'offline_canonical_navigation') {
          // Close the persistent context while its context-wide route and WebSocket boundaries are
          // still installed. There is no unguarded interval after the final proof.
          await options.close();
        } else {
          await requestBoundary.remove();
          if (requestBoundary.invalid()) unavailable();
          await options.close();
        }
        closed = true;
        if (requestBoundary.invalid()) unavailable();
      },
      close,
    };
  } catch {
    return unavailable();
  } finally {
    if (!probeReturned) await close().catch(() => undefined);
  }
}

/**
 * Build the five-lookup proof on the manual sign-in service's already-authenticated page. The
 * service owns that live document, so this path installs the strict route without navigating or
 * reloading it.
 */
export async function createKemerBetNoTransferReadinessSealProbeFromPage(options: {
  readonly accountId: string;
  readonly close: () => Promise<void>;
  readonly fingerprintAgentIdentity: KemerBetAgentIdentityFingerprinter;
  readonly page: Page;
  readonly reportForbiddenRequest?: (
    diagnostic: KemerBetReadinessSealForbiddenRequestDiagnostic,
  ) => void;
  readonly reportStage?: (stage: KemerBetNoTransferReadinessSealStage) => void;
  readonly selectorContract: KemerBetAgentPageSelectorContractV2;
}): Promise<KemerBetNoTransferReadinessSealProbe> {
  return createKemerBetNoTransferReadinessGuardedProbeFromPage({
    ...options,
    startup: { mode: 'adopt_authenticated_page' },
  });
}

export interface KemerBetNoTransferReadinessPersistentProfileProbeOptions {
  readonly accountId: string;
  readonly selectorContract: KemerBetAgentPageSelectorContractV2;
  readonly fingerprintAgentIdentity: KemerBetAgentIdentityFingerprinter;
  readonly effectiveUserId: number;
  readonly expectedAgentIdentityFingerprint?: string;
  readonly reportStage: (stage: KemerBetNoTransferReadinessSealStage) => void;
  readonly reportForbiddenRequest: (
    diagnostic: KemerBetReadinessSealForbiddenRequestDiagnostic,
  ) => void;
}

/**
 * Open a persisted authenticated profile under a zero-network startup boundary. Chromium starts
 * offline; every restored page is closed, HTTP and WebSocket guards are installed on a fresh blank
 * page, and only then is the context brought online for exact `/agents` navigation.
 */
export async function openKemerBetNoTransferReadinessPersistentProfileProbe(
  options: KemerBetNoTransferReadinessPersistentProfileProbeOptions,
): Promise<KemerBetNoTransferReadinessSealProbe> {
  const profile = await resolveSafeProfile(options.accountId, options.effectiveUserId);
  await removeStaleChromiumSingletonArtifacts(profile);
  await assertSafeDirectory(profile, options.effectiveUserId, 0o700);
  if (
    options.expectedAgentIdentityFingerprint !== undefined &&
    !FINGERPRINT_PATTERN.test(options.expectedAgentIdentityFingerprint)
  ) {
    return unavailable();
  }
  let context: BrowserContext | null = null;
  let requestBoundary: KemerBetNoTransferReadinessRequestBoundary | null = null;
  try {
    context = await chromium.launchPersistentContext(profile, {
      acceptDownloads: false,
      bypassCSP: false,
      // The transient container supplies the outer read-only, no-capability sandbox. Chromium's
      // nested namespace sandbox cannot initialize inside that boundary on the target host.
      chromiumSandbox: false,
      executablePath: KEMERBET_BROWSER_EXECUTABLE_PATH,
      headless: true,
      ignoreHTTPSErrors: false,
      offline: true,
      serviceWorkers: 'block',
      viewport: { width: 1280, height: 720 },
    });
    const retainedContext = context;
    // The context is still offline and service workers are blocked, so restored pages have zero
    // egress. Remove them before creating the context-wide proof boundary; otherwise an irrelevant
    // restored-page request could poison the fresh one-shot proof.
    await Promise.all(retainedContext.pages().map(async (restoredPage) => restoredPage.close()));
    if (retainedContext.pages().length !== 0) return unavailable();
    let page: Page | null = null;
    let webSocketObserved = false;
    let unexpectedPageObserved = false;
    let firstWebSocketReported = false;
    const externalBoundaryInvalid = () => webSocketObserved || unexpectedPageObserved;
    requestBoundary = createKemerBetNoTransferReadinessRequestBoundary({
      externalBoundaryInvalid,
      installRoute: async (handler) => {
        await retainedContext.route('**/*', handler);
      },
      page: () => page,
      removeRoute: async (handler) => {
        await retainedContext.unroute('**/*', handler);
      },
      reportForbiddenRequest: options.reportForbiddenRequest,
      reportStage: options.reportStage,
    });
    // Both context-wide protocols are guarded while the entire persistent context is still
    // offline and before the sole fresh page exists. A popup/new-page race cannot bypass them.
    await requestBoundary.install();
    await retainedContext.routeWebSocket('**/*', async (webSocket: WebSocketRoute) => {
      webSocketObserved = true;
      if (!firstWebSocketReported) {
        firstWebSocketReported = true;
        try {
          options.reportForbiddenRequest({
            reason: 'noncanonical_navigation',
            target: 'third_party',
            method: 'OTHER',
            kind: 'subresource',
          });
        } catch {
          // A fixed diagnostic callback cannot weaken the blocked WebSocket boundary.
        }
        try {
          options.reportStage('forbidden_request');
        } catch {
          // A diagnostic callback cannot connect or forward the routed WebSocket.
        }
      }
      await webSocket.close({ code: 1008, reason: 'blocked' }).catch(() => undefined);
    });
    page = await retainedContext.newPage();
    if (page.url() !== 'about:blank' || retainedContext.pages().length !== 1) return unavailable();
    context.on('page', (openedPage) => {
      if (openedPage !== page) {
        unexpectedPageObserved = true;
        void openedPage.close().catch(() => undefined);
      }
    });
    const probe = await createKemerBetNoTransferReadinessGuardedProbeFromPage({
      accountId: options.accountId,
      close: async () => retainedContext.close(),
      externalBoundaryInvalid,
      fingerprintAgentIdentity: options.fingerprintAgentIdentity,
      page,
      requestBoundary,
      reportForbiddenRequest: options.reportForbiddenRequest,
      reportStage: options.reportStage,
      selectorContract: options.selectorContract,
      startup: {
        mode: 'offline_canonical_navigation',
        setOnline: async () => retainedContext.setOffline(false),
      },
    });
    if (
      externalBoundaryInvalid() ||
      (options.expectedAgentIdentityFingerprint !== undefined &&
        probe.observedAgentIdentityFingerprint !== options.expectedAgentIdentityFingerprint)
    ) {
      await probe.close().catch(() => undefined);
      return unavailable();
    }
    return probe;
  } catch {
    await context?.close().catch(() => undefined);
    return unavailable();
  }
}

async function productionOpenProbe(options: {
  readonly accountId: string;
  readonly selectorContract: KemerBetAgentPageSelectorContractV2;
  readonly fingerprintAgentIdentity: KemerBetAgentIdentityFingerprinter;
  readonly effectiveUserId: number;
  readonly reportStage: (stage: KemerBetNoTransferReadinessSealStage) => void;
  readonly reportForbiddenRequest: (
    diagnostic: KemerBetReadinessSealForbiddenRequestDiagnostic,
  ) => void;
}): Promise<KemerBetNoTransferReadinessSealProbe> {
  return openKemerBetNoTransferReadinessPersistentProfileProbe(options);
}

async function writeBindingAtomically(
  accountId: string,
  fingerprint: string,
  effectiveUserId: number,
): Promise<void> {
  if (!UUID_PATTERN.test(accountId) || !FINGERPRINT_PATTERN.test(fingerprint)) unavailable();
  await assertSafeDirectory(OUTPUT_ROOT, effectiveUserId, 0o700);
  try {
    await lstat(OUTPUT_FILE);
    return unavailable();
  } catch (error) {
    if (!isMissing(error)) return unavailable();
  }
  const temporary = `${OUTPUT_ROOT}/.kemerbet_agent_identity_bindings.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  let installedByThisRun = false;
  let installationComplete = false;
  try {
    handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(`${accountId} ${fingerprint}\n`, { encoding: 'utf8' });
    await handle.sync();
    const written = (await handle.stat()) as SafeStat;
    if (
      !written.isFile() ||
      written.isSymbolicLink() ||
      written.uid !== effectiveUserId ||
      (written.mode & 0o777) !== 0o600
    ) {
      return unavailable();
    }
    await handle.close();
    handle = null;
    await link(temporary, OUTPUT_FILE);
    installedByThisRun = true;
    await unlink(temporary);
    const installed = (await lstat(OUTPUT_FILE)) as SafeStat;
    if (
      !installed.isFile() ||
      installed.isSymbolicLink() ||
      installed.uid !== effectiveUserId ||
      (installed.mode & 0o777) !== 0o600 ||
      (await realpath(OUTPUT_FILE)) !== OUTPUT_FILE
    ) {
      return unavailable();
    }
    installationComplete = true;
  } catch {
    return unavailable();
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    if (installedByThisRun && !installationComplete) {
      await unlink(OUTPUT_FILE).catch(() => undefined);
    }
  }
}

function defaultSuccessLog(
  result: Parameters<NonNullable<KemerBetNoTransferReadinessSealDependencies['logSuccess']>>[0],
): void {
  console.info(result, 'KemerBet readiness sealed: 5 of 5 Players, Transfer disabled.');
}

/**
 * Bind one manually authenticated browser profile and prove exactly five read-only Player lookups.
 * This command receives no database, manifest, history key, amount, transfer method, or action loop.
 */
export async function runKemerBetNoTransferReadinessSeal(
  dependencies: KemerBetNoTransferReadinessSealDependencies = {},
): Promise<void> {
  const reportStage = dependencies.reportStage ?? (() => undefined);
  const reportForbiddenRequest = dependencies.reportForbiddenRequest ?? (() => undefined);
  reportStage('environment_guard');
  const environment = dependencies.environment ?? process.env;
  const accountId = assertInertEnvironment(environment);
  const effectiveUserId =
    dependencies.effectiveUserId ??
    (typeof process.geteuid === 'function' ? process.geteuid() : Number.NaN);
  if (effectiveUserId !== 10001) return unavailable();
  reportStage('readiness_inputs');
  const [players, selectorContract, fingerprintAgentIdentity] = await Promise.all([
    dependencies.loadPlayerIds?.() ??
      loadKemerBetNoTransferReadinessPlayerIds({
        filePath: KEMERBET_NO_TRANSFER_READINESS_PLAYER_IDS_FILE,
      }),
    dependencies.loadSelectorContract?.() ??
      loadKemerBetSelectorContract({
        filePath: KEMERBET_SELECTOR_CONTRACT_FILE,
        validate: validateSelectorContract,
      }),
    dependencies.createAgentIdentityFingerprinter?.() ??
      createKemerBetAgentIdentityFingerprinter({
        secretFilePath: KEMERBET_AGENT_IDENTITY_HMAC_KEY_FILE,
      }),
    dependencies.assertBrowserExecutable?.() ??
      assertKemerBetBrowserExecutable({ executablePath: KEMERBET_BROWSER_EXECUTABLE_PATH }),
  ]);
  if (
    players.playerIds.length !== 5 ||
    new Set(players.playerIds).size !== 5 ||
    players.playerIds.some((playerId) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(playerId))
  ) {
    return unavailable();
  }
  reportStage('signed_in_page');
  const probe = await (dependencies.openProbe ?? productionOpenProbe)({
    accountId,
    selectorContract,
    fingerprintAgentIdentity,
    effectiveUserId,
    reportStage,
    reportForbiddenRequest,
  });
  try {
    if (!FINGERPRINT_PATTERN.test(probe.observedAgentIdentityFingerprint)) unavailable();
    for (const playerId of players.playerIds) {
      const result = await probe.probePlayerLookup({ playerId, currencyCode: 'ETB' });
      if (
        result?.exactPlayerMatch !== true ||
        result.exactCurrencyMatch !== true ||
        result.transferDisabled !== true
      ) {
        unavailable();
      }
    }
    reportStage('final_guard');
    await probe.finalizeReadOnlyProof();
    reportStage('binding_write');
    await (dependencies.writeBinding ?? writeBindingAtomically)(
      accountId,
      probe.observedAgentIdentityFingerprint,
      effectiveUserId,
    );
    (dependencies.logSuccess ?? defaultSuccessLog)({
      component: 'kemerbet_no_transfer_readiness_seal',
      event: 'sealed',
      accountsBound: 1,
      playersChecked: 5,
      currency: 'ETB',
      transferDisabled: true,
      identifiersRedacted: true,
      moneyMoved: false,
    });
  } catch {
    return unavailable();
  } finally {
    await probe.close().catch(() => undefined);
  }
}

export async function runKemerBetNoTransferReadinessSealMain(
  dependencies: KemerBetNoTransferReadinessSealDependencies & {
    readonly reportFailure?: () => void;
    readonly setExitCode?: (exitCode: number) => void;
  } = {},
): Promise<void> {
  try {
    await runKemerBetNoTransferReadinessSeal(dependencies);
  } catch {
    (
      dependencies.reportFailure ??
      (() => console.error('FetanAgent KemerBet no-transfer readiness seal failed closed.'))
    )();
    (dependencies.setExitCode ?? ((exitCode) => (process.exitCode = exitCode)))(1);
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  await runKemerBetNoTransferReadinessSealMain();
}
