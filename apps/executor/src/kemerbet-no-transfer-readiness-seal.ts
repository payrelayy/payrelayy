import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, open, realpath, unlink } from 'node:fs/promises';
import { isIP } from 'node:net';
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
  type CDPSession,
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
import {
  purgeKemerBetPersistedServiceWorkerState,
  removeStaleChromiumSingletonArtifacts,
} from './kemerbet-chromium-profile.js';
import {
  isKemerBetReadinessLayer7Authorization,
  KEMERBET_READINESS_LAYER7_AUTHORIZATION_HEADER,
} from './kemerbet-readiness-layer7-authorization.js';
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
const AGENT_PROFILE_PIN_PATTERN = /^hmac-sha256-agent-profile-pin-v3:[0-9a-f]{64}$/u;
const AGENT_IDENTITY_FINGERPRINT_PREFIX = 'hmac-sha256-agent-identity-v1:';
const AGENT_PROFILE_PIN_PREFIX = 'hmac-sha256-agent-profile-pin-v3:';
const PROVIDER_AUTHORIZATION_PATTERN = /^Bearer [A-Za-z0-9._~+\/-]{16,4096}={0,2}$/u;
const PROVIDER_AUTHORIZATION_DIGEST_PATTERN = /^sha256-provider-authorization-v1:[0-9a-f]{64}$/u;
const EXACT_PROVIDER_AUTHORIZATION_OBSERVATIONS = 5;
const EXACT_BINDING_FILE_BYTES = 230;
const PLAYER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const KEMERBET_LOOKUP_PREFLIGHT_REQUEST_HEADERS = new Set(['authorization', 'content-type']);
const KEMERBET_AGENT_API_HOSTNAME = new URL(KEMERBET_AGENT_API_ORIGIN).hostname;
const KEMERBET_AGENT_WEB_HOSTNAME = new URL(KEMERBET_AGENT_DEPOSIT_URL).hostname;
const KEMERBET_AGENT_BOOTSTRAP_ORIGIN = 'https://agt-client-akm.agent-digi.com';
const KEMERBET_READINESS_LAYER7_PROXY_PORT = 18443;
const KEMERBET_SERVICE_WORKER_ORIGINS = Object.freeze([
  new URL(KEMERBET_AGENT_DEPOSIT_URL).origin,
  KEMERBET_AGENT_API_ORIGIN,
  KEMERBET_AGENT_BOOTSTRAP_ORIGIN,
] as const);
const CHROMIUM_SPKI_SHA256_PATTERN = /^[A-Za-z0-9+/]{43}=$/u;
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
const KEMERBET_OPTIONAL_SIGNALR_WEBSOCKET_HOSTNAMES = new Set([
  'admin-api.agt-digi.com',
  'job.agt-digi.com',
  'widget-api.agt-digi.com',
]);
const KEMERBET_OPTIONAL_SIGNALR_ACCESS_TOKEN_PATTERN = /^[A-Za-z0-9._~+\/-]{16,4096}={0,2}$/u;
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
  readonly nlink: number;
  readonly size: number;
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface KemerBetNoTransferReadinessSealProbe {
  readonly observedAgentIdentityFingerprint: string;
  providerAuthorizationDigest(): string;
  probePlayerLookup(target: {
    readonly playerId: string;
    readonly currencyCode: 'ETB';
    readonly layer7Authorization?: string;
  }): Promise<{
    readonly exactPlayerMatch: true;
    readonly exactCurrencyMatch: true;
    readonly transferDisabled: true;
  } | null>;
  /** Drain the proof route, stop its browser ownership, and reject any forbidden request attempt. */
  finalizeReadOnlyProof(): Promise<void>;
  close(): Promise<void>;
}

export function buildKemerBetReadinessIsolatedChromiumHostResolverRules(proxyIpv4: string): string {
  if (isIP(proxyIpv4) !== 4) unavailable();
  return [
    `MAP ${KEMERBET_AGENT_WEB_HOSTNAME}:443 ${proxyIpv4}:${KEMERBET_READINESS_LAYER7_PROXY_PORT}`,
    `MAP ${KEMERBET_AGENT_API_HOSTNAME}:443 ${proxyIpv4}:${KEMERBET_READINESS_LAYER7_PROXY_PORT}`,
    `MAP ${new URL(KEMERBET_AGENT_BOOTSTRAP_ORIGIN).hostname}:443 ${proxyIpv4}:${KEMERBET_READINESS_LAYER7_PROXY_PORT}`,
    `EXCLUDE ${proxyIpv4}`,
    'EXCLUDE localhost',
    'MAP * ~NOTFOUND',
  ].join(', ');
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
    agentProfilePin: string,
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

export interface KemerBetReadinessTransportHeader {
  readonly name: string;
  readonly value: string;
}

export interface KemerBetReadinessProviderAuthorizationDigestTracker {
  capture(headers: readonly KemerBetReadinessTransportHeader[]): void;
  complete(): string;
  destroy(): void;
  invalid(): boolean;
}

/**
 * Bind the seal only to the provider credential Chromium actually put on all five lookup GETs.
 * The duplicate-preserving transport header list is consumed synchronously; only one SHA-256
 * digest survives between observations, and every raw byte buffer is zeroed before returning.
 */
export function createKemerBetReadinessProviderAuthorizationDigestTracker(): KemerBetReadinessProviderAuthorizationDigestTracker {
  let observations = 0;
  let pinnedDigest: Buffer | null = null;
  let state: 'collecting' | 'completed' | 'failed' | 'destroyed' = 'collecting';

  const erase = (): void => {
    pinnedDigest?.fill(0);
    pinnedDigest = null;
  };
  const fail = (): never => {
    erase();
    state = 'failed';
    return unavailable();
  };

  return Object.freeze({
    capture(headers: readonly KemerBetReadinessTransportHeader[]) {
      let encodedAuthorization: Buffer | null = null;
      let candidateDigest: Buffer | null = null;
      try {
        if (
          state !== 'collecting' ||
          observations >= EXACT_PROVIDER_AUTHORIZATION_OBSERVATIONS ||
          !Array.isArray(headers) ||
          headers.length < 1 ||
          headers.length > 128
        ) {
          return fail();
        }
        const authorizations: string[] = [];
        for (const header of headers) {
          if (
            typeof header !== 'object' ||
            header === null ||
            typeof header.name !== 'string' ||
            typeof header.value !== 'string' ||
            header.name.length < 1 ||
            header.name.length > 256 ||
            header.value.length > 8_192 ||
            /[\r\n\0]/u.test(header.name) ||
            /[\r\n\0]/u.test(header.value)
          ) {
            return fail();
          }
          if (header.name.toLowerCase() === 'authorization') {
            authorizations.push(header.value);
          }
        }
        const authorization = authorizations[0];
        if (
          authorizations.length !== 1 ||
          authorization === undefined ||
          !PROVIDER_AUTHORIZATION_PATTERN.test(authorization)
        ) {
          return fail();
        }
        encodedAuthorization = Buffer.from(authorization, 'utf8');
        candidateDigest = createHash('sha256').update(encodedAuthorization).digest();
        if (candidateDigest.length !== 32) return fail();
        if (pinnedDigest === null) {
          pinnedDigest = Buffer.from(candidateDigest);
        } else if (
          pinnedDigest.length !== candidateDigest.length ||
          !timingSafeEqual(pinnedDigest, candidateDigest)
        ) {
          return fail();
        }
        observations += 1;
      } catch {
        return fail();
      } finally {
        encodedAuthorization?.fill(0);
        candidateDigest?.fill(0);
      }
    },
    complete() {
      if (
        state !== 'collecting' ||
        observations !== EXACT_PROVIDER_AUTHORIZATION_OBSERVATIONS ||
        pinnedDigest === null ||
        pinnedDigest.length !== 32
      ) {
        return fail();
      }
      const labeledDigest = `sha256-provider-authorization-v1:${pinnedDigest.toString('hex')}`;
      erase();
      state = 'completed';
      if (!PROVIDER_AUTHORIZATION_DIGEST_PATTERN.test(labeledDigest)) return fail();
      return labeledDigest;
    },
    destroy() {
      erase();
      state = 'destroyed';
    },
    invalid: () => state === 'failed',
  });
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

/**
 * Recognize only the reviewed SignalR notification socket shape. The raw query is deliberately
 * canonical: encoded, reordered, duplicate, and additional keys are not treated as optional.
 */
export function isKnownOptionalKemerBetSignalRWebSocket(rawUrl: string): boolean {
  if (rawUrl.length < 1 || rawUrl.length > 4_384 || /[\r\n\0]/u.test(rawUrl)) return false;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (
    url.protocol !== 'wss:' ||
    !KEMERBET_OPTIONAL_SIGNALR_WEBSOCKET_HOSTNAMES.has(url.hostname) ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.pathname !== '/ws' ||
    url.hash !== ''
  ) {
    return false;
  }
  if (rawUrl !== `wss://${url.hostname}/ws${url.search}`) return false;
  const match = /^\?accessToken=([^&]+)&apiType=admin$/u.exec(url.search);
  return (
    match !== null &&
    match[1] !== undefined &&
    KEMERBET_OPTIONAL_SIGNALR_ACCESS_TOKEN_PATTERN.test(match[1])
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
  if (input.isNavigationRequest) {
    if (!input.isMainFrame || input.method !== 'GET' || url.href !== KEMERBET_AGENT_DEPOSIT_URL) {
      return forbiddenRequestClassification('noncanonical_navigation', target, method, kind);
    }
    return Object.freeze({ decision: 'allow' });
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
  headersArray?(): Promise<readonly KemerBetReadinessTransportHeader[]>;
  isNavigationRequest(): boolean;
  method(): string;
  resourceType?(): string;
  url(): string;
}

export interface KemerBetReadinessSealRoutePort {
  request(): KemerBetReadinessSealRequestPort;
  abort(errorCode: 'blockedbyclient'): Promise<unknown>;
  continue(options?: { readonly headers?: Record<string, string> }): Promise<unknown>;
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
  try {
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
    await applyKemerBetReadinessSealRouteDecision(
      route,
      request,
      classification,
      reportStage,
      expectedPlayerId,
      null,
    );
  } catch {
    await route.abort('blockedbyclient').catch(() => undefined);
    return unavailable();
  }
}

async function applyKemerBetReadinessSealRouteDecision(
  route: KemerBetReadinessSealRoutePort,
  request: KemerBetReadinessSealRequestPort,
  classification: KemerBetReadinessSealRequestClassification,
  reportStage: (stage: KemerBetNoTransferReadinessSealStage) => void,
  expectedPlayerId: string | null,
  expectedLayer7Authorization: string | null,
): Promise<void> {
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
    if (expectedLayer7Authorization !== null) {
      const headers = request.headers?.() ?? {};
      if (
        Object.keys(headers).some(
          (name) => name.toLowerCase() === KEMERBET_READINESS_LAYER7_AUTHORIZATION_HEADER,
        )
      ) {
        return unavailable();
      }
      await route.continue({
        headers: {
          ...headers,
          [KEMERBET_READINESS_LAYER7_AUTHORIZATION_HEADER]: expectedLayer7Authorization,
        },
      });
      return;
    }
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

export interface KemerBetNoTransferReadinessRequestBoundary {
  readonly armCanonicalMainNavigation: () => void;
  readonly beginTerminalClose: () => void;
  readonly canonicalMainNavigationConsumed: () => boolean;
  readonly detachAfterOwnerClose: () => void;
  readonly drain: () => Promise<void>;
  readonly completeProviderAuthorizationDigest: () => string;
  readonly destroyProviderAuthorizationDigest: () => void;
  readonly install: () => Promise<void>;
  readonly internalViolation: () => boolean;
  readonly invalid: () => boolean;
  readonly remove: () => Promise<void>;
  readonly withExpectedPlayerLookup: <T>(
    playerId: string,
    layer7Authorization: string | null,
    action: () => Promise<T>,
  ) => Promise<T>;
}

export function createKemerBetNoTransferReadinessRequestBoundary(options: {
  readonly externalBoundaryInvalid?: (() => boolean) | undefined;
  readonly installRoute: (handler: (route: Route) => Promise<void>) => Promise<void>;
  readonly page: () => Page | null;
  readonly removeRoute: (handler: (route: Route) => Promise<void>) => Promise<void>;
  readonly reportForbiddenRequest?:
    ((diagnostic: KemerBetReadinessSealForbiddenRequestDiagnostic) => void) | undefined;
  readonly reportStage: (stage: KemerBetNoTransferReadinessSealStage) => void;
}): KemerBetNoTransferReadinessRequestBoundary {
  let activeExpectedPlayerId: string | null = null;
  let activeLayer7Authorization: string | null = null;
  let activeExpectedLookupConsumed = false;
  let canonicalMainNavigationArmed = false;
  let canonicalMainNavigationWasConsumed = false;
  let forbiddenRequestObserved = false;
  let firstForbiddenRequest: KemerBetReadinessSealForbiddenRequestDiagnostic | undefined;
  let routeHandlerFailureObserved = false;
  let terminalCloseStarted = false;
  let terminalRouteObserved = false;
  let installed = false;
  const operations = new Set<Promise<void>>();
  const providerAuthorizationDigestTracker =
    createKemerBetReadinessProviderAuthorizationDigestTracker();
  const externalBoundaryInvalid = (): boolean => {
    try {
      return options.externalBoundaryInvalid?.() === true;
    } catch {
      return true;
    }
  };
  const invalid = (): boolean =>
    forbiddenRequestObserved ||
    routeHandlerFailureObserved ||
    providerAuthorizationDigestTracker.invalid() ||
    externalBoundaryInvalid();
  const internalViolation = (): boolean =>
    forbiddenRequestObserved || routeHandlerFailureObserved || terminalRouteObserved;
  const routeHandler = (route: Route): Promise<void> => {
    const operation = (async () => {
      try {
        if (terminalCloseStarted) {
          terminalRouteObserved = true;
          await route.abort('blockedbyclient').catch(() => undefined);
          return;
        }
        const page = options.page();
        if (page === null) {
          routeHandlerFailureObserved = true;
          await route.abort('blockedbyclient').catch(() => undefined);
          return;
        }
        const request = route.request();
        const expectedPlayerId = activeExpectedPlayerId;
        const expectedLayer7Authorization = activeLayer7Authorization;
        const isMainFrame = request.frame() === page.mainFrame();
        const isNavigationRequest = request.isNavigationRequest();
        let classification = classifyKemerBetReadinessSealRequest({
          expectedPlayerId,
          headers: request.headers(),
          isMainFrame,
          isNavigationRequest,
          method: request.method(),
          requestUrl: request.url(),
          resourceType: request.resourceType(),
        });
        if (classification.decision === 'allow' && isNavigationRequest && isMainFrame) {
          if (!canonicalMainNavigationArmed || canonicalMainNavigationWasConsumed) {
            classification = forbiddenRequestClassification(
              'noncanonical_navigation',
              'agent_web',
              'GET',
              'main_navigation',
            );
          } else {
            canonicalMainNavigationArmed = false;
            canonicalMainNavigationWasConsumed = true;
          }
        }
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
        const isCurrentExpectedLookup = isExactKemerBetReadinessSealPlayerLookupRequest({
          expectedPlayerId,
          method: request.method(),
          requestUrl: request.url(),
        });
        if (isCurrentExpectedLookup && activeExpectedLookupConsumed) {
          routeHandlerFailureObserved = true;
          await route.abort('blockedbyclient').catch(() => undefined);
          return;
        }
        if (isCurrentExpectedLookup) {
          // Reserve synchronously before the duplicate-preserving complete-header read. A second
          // routed GET cannot cross this point while the first Request is awaiting headers.
          activeExpectedLookupConsumed = true;
          if (typeof request.headersArray !== 'function') return unavailable();
          providerAuthorizationDigestTracker.capture(await request.headersArray());
        }
        await applyKemerBetReadinessSealRouteDecision(
          route,
          request,
          classification,
          options.reportStage,
          expectedPlayerId,
          expectedLayer7Authorization,
        );
      } catch {
        routeHandlerFailureObserved = true;
        // Request.frame() throws for service-worker-originated requests. Every classifier or route
        // failure is sticky and the route is still best-effort aborted; it is never continued.
        await route.abort('blockedbyclient').catch(() => undefined);
      }
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
    armCanonicalMainNavigation() {
      if (
        !installed ||
        canonicalMainNavigationArmed ||
        canonicalMainNavigationWasConsumed ||
        invalid()
      ) {
        return unavailable();
      }
      canonicalMainNavigationArmed = true;
    },
    beginTerminalClose() {
      if (!installed || terminalCloseStarted || activeExpectedPlayerId !== null || invalid()) {
        return unavailable();
      }
      terminalCloseStarted = true;
    },
    canonicalMainNavigationConsumed: () =>
      canonicalMainNavigationWasConsumed && !canonicalMainNavigationArmed,
    detachAfterOwnerClose() {
      if (!installed || !terminalCloseStarted || operations.size !== 0 || internalViolation()) {
        return unavailable();
      }
      // The exact owner BrowserContext has already confirmed close. Do not call Page.unroute on a
      // destroyed target; only detach this local handler reference after the terminal latch/drain.
      installed = false;
    },
    async drain() {
      while (operations.size > 0) await Promise.allSettled([...operations]);
    },
    completeProviderAuthorizationDigest: () => providerAuthorizationDigestTracker.complete(),
    destroyProviderAuthorizationDigest: () => providerAuthorizationDigestTracker.destroy(),
    async install() {
      if (installed) return unavailable();
      await options.installRoute(routeHandler);
      installed = true;
    },
    internalViolation,
    invalid,
    async remove() {
      if (!installed) return;
      await options.removeRoute(routeHandler);
      installed = false;
      while (operations.size > 0) await Promise.allSettled([...operations]);
    },
    async withExpectedPlayerLookup(playerId, layer7Authorization, action) {
      if (
        terminalCloseStarted ||
        !PLAYER_ID_PATTERN.test(playerId) ||
        (layer7Authorization !== null &&
          !isKemerBetReadinessLayer7Authorization(layer7Authorization)) ||
        activeExpectedPlayerId !== null ||
        invalid()
      ) {
        return unavailable();
      }
      activeExpectedPlayerId = playerId;
      activeLayer7Authorization = layer7Authorization;
      activeExpectedLookupConsumed = false;
      try {
        const result = await action();
        while (operations.size > 0) await Promise.allSettled([...operations]);
        if (invalid()) unavailable();
        if (!activeExpectedLookupConsumed) unavailable();
        return result;
      } finally {
        activeExpectedPlayerId = null;
        activeLayer7Authorization = null;
        activeExpectedLookupConsumed = false;
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
  readonly terminalLifecycleBoundary?: Pick<
    KemerBetReadinessPersistentLifecycleBoundary,
    'beginTerminalClose' | 'drain' | 'internalViolation'
  >;
  readonly startup:
    | { readonly mode: 'adopt_authenticated_page' }
    | {
        readonly mode: 'offline_restored_canonical_navigation';
        readonly armCanonicalNavigation: () => void;
        readonly canonicalNavigationCommitted: () => boolean;
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
  let sealedProviderAuthorizationDigest: string | null = null;
  const close = async (): Promise<void> => {
    if (closed) return;
    try {
      if (options.startup.mode === 'offline_restored_canonical_navigation') {
        // Never unroute a persistent browser. If context closure fails, propagate while the
        // context-wide guards remain installed until a later close retry or container death.
        await options.close();
      } else {
        await requestBoundary.remove().catch(() => undefined);
        await options.close();
      }
      closed = true;
    } finally {
      requestBoundary.destroyProviderAuthorizationDigest();
    }
  };
  try {
    reportStage('route_guard');
    const expectedStartupUrl = KEMERBET_AGENT_DEPOSIT_URL;
    if (options.page.url() !== expectedStartupUrl) unavailable();
    if (ownsRequestBoundary) await requestBoundary.install();
    if (options.page.url() !== expectedStartupUrl || requestBoundary.invalid()) unavailable();
    if (options.startup.mode === 'offline_restored_canonical_navigation') {
      // The persistent context and its exact restored `/agents` page are launched offline. Install
      // the complete context-wide boundaries first, then navigate that same page after bringing it
      // online. Same-page navigation preserves KemerBet's page-scoped sessionStorage; a fresh page
      // would silently discard the manually authenticated session.
      requestBoundary.armCanonicalMainNavigation();
      options.startup.armCanonicalNavigation();
      await options.startup.setOnline();
      if (requestBoundary.invalid()) unavailable();
      await options.page.goto(KEMERBET_AGENT_DEPOSIT_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      await options.page.waitForTimeout(250);
      await requestBoundary.drain();
      if (
        !requestBoundary.canonicalMainNavigationConsumed() ||
        !options.startup.canonicalNavigationCommitted() ||
        requestBoundary.invalid()
      ) {
        unavailable();
      }
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
      providerAuthorizationDigest: () => {
        if (
          !closed ||
          sealedProviderAuthorizationDigest === null ||
          !PROVIDER_AUTHORIZATION_DIGEST_PATTERN.test(sealedProviderAuthorizationDigest)
        ) {
          return unavailable();
        }
        return sealedProviderAuthorizationDigest;
      },
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
        await requestBoundary.withExpectedPlayerLookup(
          target.playerId,
          target.layer7Authorization ?? null,
          async () => {
            await agentPage.lookupPlayer(target.playerId);
          },
        );
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
        // page. Both production modes close the exact owner context here before a binding can be
        // installed; the supervised sign-in service transitions its same-UID session inactive.
        await options.page.waitForTimeout(250);
        await requestBoundary.drain();
        if (requestBoundary.invalid()) unavailable();
        sealedProviderAuthorizationDigest = requestBoundary.completeProviderAuthorizationDigest();
        if (options.startup.mode === 'offline_restored_canonical_navigation') {
          // Enter the terminal latch before close. Every route that starts from this point is
          // sticky-aborted, and a second drain plus the internal-only violation flag prevents an
          // expected Page/Context close from hiding a forbidden request or handler race.
          options.terminalLifecycleBoundary?.beginTerminalClose();
          requestBoundary.beginTerminalClose();
          await options.close();
          await requestBoundary.drain();
          await options.terminalLifecycleBoundary?.drain();
          if (
            requestBoundary.internalViolation() ||
            options.terminalLifecycleBoundary?.internalViolation() === true
          ) {
            unavailable();
          }
        } else {
          requestBoundary.beginTerminalClose();
          await options.close();
          await requestBoundary.drain();
          if (requestBoundary.internalViolation()) unavailable();
          requestBoundary.detachAfterOwnerClose();
          if (requestBoundary.internalViolation()) unavailable();
        }
        closed = true;
        // Closing the persistent context intentionally destroys its only Page, so topology checks
        // are meaningful only before that exact close. A successful awaited close is the terminal
        // safety boundary. The adopted-page path locally detaches its terminal handler only after
        // that exact close succeeds; it never creates an unroute-before-close window.
        if (options.startup.mode === 'adopt_authenticated_page' && requestBoundary.invalid()) {
          unavailable();
        }
        requestBoundary.destroyProviderAuthorizationDigest();
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
  readonly isolatedBrowserDriverBoundary?: {
    readonly proxyIpv4: string;
    readonly proxySpkiSha256: string;
    readonly revalidateNetworkTopology: () => Promise<void>;
  };
}

type KemerBetRestoredPage = Pick<Page, 'isClosed' | 'url'>;

/**
 * Select only the one exact restored KemerBet `/agents` page. The optional expected object makes
 * later topology checks fail closed if Chromium replaces the original browsing context.
 */
export function selectSoleCanonicalKemerBetAgentRestoredPage<T extends KemerBetRestoredPage>(
  pages: readonly T[],
  expectedPage?: T,
): T | null {
  try {
    if (pages.length !== 1) return null;
    const page = pages[0];
    if (
      page === undefined ||
      (expectedPage !== undefined && page !== expectedPage) ||
      page.isClosed() ||
      page.url() !== KEMERBET_AGENT_DEPOSIT_URL
    ) {
      return null;
    }
    return page;
  } catch {
    return null;
  }
}

export interface KemerBetReadinessPersistentLifecycleBoundary {
  armCanonicalNavigation(): void;
  beginTerminalClose(): void;
  canonicalNavigationCommitted(): boolean;
  drain(): Promise<void>;
  expectContextClose(): void;
  internalViolation(): boolean;
  invalid(): boolean;
  observeContextClose(): void;
  observeFrameNavigation(input: { readonly isMainFrame: boolean; readonly url: string }): void;
  observePage(input: { readonly isRetainedPage: boolean }): void;
  observePageClose(): void;
  observePageCrash(): void;
  observeServiceWorker(): void;
  observeWebSocket(): void;
  track(operation: Promise<void>): Promise<void>;
}

/**
 * Close every routed socket locally. Only the exact reviewed SignalR notification socket is
 * non-poisoning; every other socket attempt remains a sticky lifecycle violation.
 */
export async function closeKemerBetReadinessGuardedWebSocket(options: {
  readonly lifecycleBoundary: Pick<
    KemerBetReadinessPersistentLifecycleBoundary,
    'observeWebSocket'
  >;
  readonly reportUnexpected: () => void;
  readonly webSocket: Pick<WebSocketRoute, 'close' | 'url'>;
}): Promise<void> {
  let knownOptional = false;
  try {
    knownOptional = isKnownOptionalKemerBetSignalRWebSocket(options.webSocket.url());
  } catch {
    knownOptional = false;
  }
  try {
    if (!knownOptional) {
      options.lifecycleBoundary.observeWebSocket();
      try {
        options.reportUnexpected();
      } catch {
        // A fixed diagnostic callback cannot weaken the already-sticky WebSocket boundary.
      }
    }
  } finally {
    // No routed socket is ever connected to its server, including reviewed optional sockets.
    await options.webSocket.close({ code: 1008, reason: 'blocked' });
  }
}

/**
 * Keep every persistent-context lifecycle violation sticky and independently testable. Dynamic
 * page/service-worker inventories are re-read on every boundary check; event observations can only
 * move the controller from valid to invalid.
 */
export function createKemerBetReadinessPersistentLifecycleBoundary(options: {
  readonly exactRestoredPageTopology: () => boolean;
  readonly noServiceWorkers: () => boolean;
}): KemerBetReadinessPersistentLifecycleBoundary {
  let canonicalFrameNavigationArmed = false;
  let canonicalFrameNavigationCommitted = false;
  let contextCloseExpected = false;
  let contextClosedUnexpectedly = false;
  let retainedPageClosedUnexpectedly = false;
  let retainedPageCrashed = false;
  let serviceWorkerObserved = false;
  let unexpectedFrameNavigationObserved = false;
  let unexpectedPageObserved = false;
  let webSocketObserved = false;
  let terminalCloseStarted = false;
  const operations = new Set<Promise<void>>();
  const internalViolation = () =>
    webSocketObserved ||
    unexpectedPageObserved ||
    serviceWorkerObserved ||
    unexpectedFrameNavigationObserved ||
    retainedPageClosedUnexpectedly ||
    retainedPageCrashed ||
    contextClosedUnexpectedly;
  const invalid = () => {
    let exactTopology = false;
    let serviceWorkersAbsent = false;
    try {
      exactTopology = options.exactRestoredPageTopology();
      serviceWorkersAbsent = options.noServiceWorkers();
    } catch {
      exactTopology = false;
      serviceWorkersAbsent = false;
    }
    return internalViolation() || !exactTopology || !serviceWorkersAbsent;
  };
  return Object.freeze({
    armCanonicalNavigation: () => {
      if (canonicalFrameNavigationArmed || canonicalFrameNavigationCommitted || invalid()) {
        unavailable();
      }
      canonicalFrameNavigationArmed = true;
    },
    beginTerminalClose: () => {
      if (terminalCloseStarted || invalid()) unavailable();
      terminalCloseStarted = true;
      contextCloseExpected = true;
    },
    canonicalNavigationCommitted: () =>
      canonicalFrameNavigationCommitted && !canonicalFrameNavigationArmed,
    drain: async () => {
      while (operations.size > 0) await Promise.allSettled([...operations]);
    },
    expectContextClose: () => {
      if (contextClosedUnexpectedly) unavailable();
      if (contextCloseExpected) return;
      if (invalid()) unavailable();
      contextCloseExpected = true;
    },
    internalViolation,
    invalid,
    observeContextClose: () => {
      if (!contextCloseExpected) contextClosedUnexpectedly = true;
    },
    observeFrameNavigation: (input: { readonly isMainFrame: boolean; readonly url: string }) => {
      if (
        !terminalCloseStarted &&
        input.isMainFrame &&
        canonicalFrameNavigationArmed &&
        !canonicalFrameNavigationCommitted &&
        input.url === KEMERBET_AGENT_DEPOSIT_URL
      ) {
        canonicalFrameNavigationArmed = false;
        canonicalFrameNavigationCommitted = true;
      } else {
        unexpectedFrameNavigationObserved = true;
      }
    },
    observePage: (input: { readonly isRetainedPage: boolean }) => {
      if (!input.isRetainedPage) unexpectedPageObserved = true;
    },
    observePageClose: () => {
      if (!terminalCloseStarted) retainedPageClosedUnexpectedly = true;
    },
    observePageCrash: () => {
      retainedPageCrashed = true;
    },
    observeServiceWorker: () => {
      serviceWorkerObserved = true;
    },
    observeWebSocket: () => {
      webSocketObserved = true;
    },
    track: async (operation: Promise<void>) => {
      operations.add(operation);
      try {
        await operation;
      } catch {
        webSocketObserved = true;
      } finally {
        operations.delete(operation);
      }
    },
  });
}

export async function prepareKemerBetIsolatedBrowserDriverOfflineContext(
  context: BrowserContext,
  page: Page,
): Promise<CDPSession> {
  let session: CDPSession;
  try {
    session = await context.newCDPSession(page);
    for (const origin of KEMERBET_SERVICE_WORKER_ORIGINS) {
      await session.send('Storage.clearDataForOrigin', {
        origin,
        storageTypes: 'service_workers,cache_storage',
      });
    }
    await session.send('ServiceWorker.stopAllWorkers');
    await session.send('Network.setBypassServiceWorker', { bypass: true });
    await session.send('Network.setCacheDisabled', { cacheDisabled: true });
    if (context.serviceWorkers().length !== 0) unavailable();
    return session;
  } catch {
    return unavailable();
  }
}

/**
 * Open a persisted authenticated profile under a two-layer zero-network startup boundary. The
 * container starts on a Docker-internal bridge whose IPv4 and IPv6 gateways are both isolated;
 * Chromium also starts offline and restores exactly one canonical `/agents` page. HTTP and WebSocket
 * guards are installed before an aggregate-only host handshake permits network attachment and that
 * same page goes online, preserving its page-scoped authenticated session without ever reading or
 * exporting session storage.
 */
export async function openKemerBetNoTransferReadinessPersistentProfileProbe(
  options: KemerBetNoTransferReadinessPersistentProfileProbeOptions,
): Promise<KemerBetNoTransferReadinessSealProbe> {
  const profile = await resolveSafeProfile(options.accountId, options.effectiveUserId);
  await removeStaleChromiumSingletonArtifacts(profile);
  await assertSafeDirectory(profile, options.effectiveUserId, 0o700);
  const isolatedBoundary = options.isolatedBrowserDriverBoundary;
  if (
    isolatedBoundary === undefined ||
    isIP(isolatedBoundary.proxyIpv4) !== 4 ||
    !CHROMIUM_SPKI_SHA256_PATTERN.test(isolatedBoundary.proxySpkiSha256)
  ) {
    return unavailable();
  }
  await purgeKemerBetPersistedServiceWorkerState(profile, options.effectiveUserId);
  await isolatedBoundary.revalidateNetworkTopology().catch(() => unavailable());
  if (
    options.expectedAgentIdentityFingerprint !== undefined &&
    !FINGERPRINT_PATTERN.test(options.expectedAgentIdentityFingerprint)
  ) {
    return unavailable();
  }
  let context: BrowserContext | null = null;
  let requestBoundary: KemerBetNoTransferReadinessRequestBoundary | null = null;
  let isolatedCdpSession: CDPSession | null = null;
  try {
    context = await chromium.launchPersistentContext(profile, {
      acceptDownloads: false,
      bypassCSP: false,
      // The transient container supplies the outer read-only, no-capability sandbox. Chromium's
      // nested namespace sandbox cannot initialize inside that boundary on the target host.
      chromiumSandbox: false,
      executablePath: KEMERBET_BROWSER_EXECUTABLE_PATH,
      headless: true,
      // A persistent Playwright launch normally appends a fresh `about:blank` page. Suppress only
      // that positional page and explicitly restore the prior tab so the exact page-scoped KemerBet
      // session can be retained under the offline startup boundary.
      args: [
        '--restore-last-session',
        '--disable-quic',
        '--dns-prefetch-disable',
        '--disable-features=NetworkPrediction,PreconnectToSearch,SpeculationRulesPrefetchFuture,WebTransport',
        '--disable-network-prediction',
        '--disable-preconnect',
        '--disable-webrtc',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        `--host-resolver-rules=${buildKemerBetReadinessIsolatedChromiumHostResolverRules(isolatedBoundary.proxyIpv4)}`,
        `--ignore-certificate-errors-spki-list=${isolatedBoundary.proxySpkiSha256}`,
      ],
      ignoreDefaultArgs: ['about:blank'],
      ignoreHTTPSErrors: false,
      offline: true,
      serviceWorkers: 'block',
      viewport: { width: 1280, height: 720 },
    });
    await isolatedBoundary.revalidateNetworkTopology().catch(() => unavailable());
    const retainedContext = context;
    const restoredPage = selectSoleCanonicalKemerBetAgentRestoredPage(retainedContext.pages());
    if (restoredPage === null) return unavailable();
    let page: Page | null = restoredPage;
    let firstWebSocketReported = false;
    const exactRestoredPageTopology = () =>
      selectSoleCanonicalKemerBetAgentRestoredPage(retainedContext.pages(), restoredPage) ===
      restoredPage;
    const noServiceWorkers = () => {
      try {
        return retainedContext.serviceWorkers().length === 0;
      } catch {
        return false;
      }
    };
    const lifecycleBoundary = createKemerBetReadinessPersistentLifecycleBoundary({
      exactRestoredPageTopology,
      noServiceWorkers,
    });
    const externalBoundaryInvalid = lifecycleBoundary.invalid;
    restoredPage.on('close', () => {
      lifecycleBoundary.observePageClose();
    });
    restoredPage.on('crash', () => {
      lifecycleBoundary.observePageCrash();
    });
    restoredPage.on('framenavigated', (frame) => {
      let isMainFrame = false;
      let url = '';
      try {
        isMainFrame = frame === restoredPage.mainFrame();
        url = frame.url();
      } catch {
        isMainFrame = false;
        url = '';
      }
      lifecycleBoundary.observeFrameNavigation({ isMainFrame, url });
    });
    retainedContext.on('page', (openedPage) => {
      lifecycleBoundary.observePage({ isRetainedPage: openedPage === restoredPage });
      if (openedPage !== restoredPage) {
        void lifecycleBoundary.track(openedPage.close());
      }
    });
    retainedContext.on('serviceworker', () => {
      lifecycleBoundary.observeServiceWorker();
    });
    retainedContext.on('close', () => {
      lifecycleBoundary.observeContextClose();
    });
    if (externalBoundaryInvalid()) return unavailable();
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
    // offline. A popup/new-page race cannot bypass them or replace the restored browsing context.
    await requestBoundary.install();
    await retainedContext.routeWebSocket('**/*', async (webSocket: WebSocketRoute) => {
      await lifecycleBoundary.track(
        closeKemerBetReadinessGuardedWebSocket({
          lifecycleBoundary,
          reportUnexpected: () => {
            if (firstWebSocketReported) return;
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
          },
          webSocket,
        }),
      );
    });
    if (externalBoundaryInvalid() || requestBoundary.invalid()) return unavailable();
    isolatedCdpSession = await prepareKemerBetIsolatedBrowserDriverOfflineContext(
      retainedContext,
      restoredPage,
    );
    await isolatedBoundary.revalidateNetworkTopology().catch(() => unavailable());
    const revalidateReleasedNetworkTopology = isolatedBoundary.revalidateNetworkTopology;
    if (externalBoundaryInvalid() || requestBoundary.invalid()) return unavailable();
    const probe = await createKemerBetNoTransferReadinessGuardedProbeFromPage({
      accountId: options.accountId,
      close: async () => {
        lifecycleBoundary.expectContextClose();
        await retainedContext.close();
      },
      externalBoundaryInvalid,
      fingerprintAgentIdentity: options.fingerprintAgentIdentity,
      page,
      requestBoundary,
      reportForbiddenRequest: options.reportForbiddenRequest,
      reportStage: options.reportStage,
      selectorContract: options.selectorContract,
      terminalLifecycleBoundary: lifecycleBoundary,
      startup: {
        mode: 'offline_restored_canonical_navigation',
        armCanonicalNavigation: () => {
          if (requestBoundary?.invalid()) unavailable();
          lifecycleBoundary.armCanonicalNavigation();
        },
        canonicalNavigationCommitted: lifecycleBoundary.canonicalNavigationCommitted,
        setOnline: async () => {
          if (externalBoundaryInvalid() || requestBoundary?.invalid()) return unavailable();
          await revalidateReleasedNetworkTopology();
          if (externalBoundaryInvalid() || requestBoundary?.invalid()) return unavailable();
          await retainedContext.setOffline(false);
          await revalidateReleasedNetworkTopology();
          if (externalBoundaryInvalid() || requestBoundary?.invalid()) return unavailable();
        },
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
    await isolatedCdpSession?.detach().catch(() => undefined);
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

export function serializeKemerBetNoTransferReadinessAgentIdentityBinding(
  accountId: string,
  fingerprint: string,
  agentProfilePin: string,
): string {
  if (
    !UUID_PATTERN.test(accountId) ||
    !FINGERPRINT_PATTERN.test(fingerprint) ||
    !AGENT_PROFILE_PIN_PATTERN.test(agentProfilePin) ||
    fingerprint.slice(AGENT_IDENTITY_FINGERPRINT_PREFIX.length) !==
      agentProfilePin.slice(AGENT_PROFILE_PIN_PREFIX.length)
  ) {
    unavailable();
  }
  const serializedBinding = `${accountId} ${fingerprint} ${agentProfilePin}\n`;
  if (Buffer.byteLength(serializedBinding, 'utf8') !== EXACT_BINDING_FILE_BYTES) unavailable();
  return serializedBinding;
}

async function writeBindingAtomically(
  accountId: string,
  fingerprint: string,
  agentProfilePin: string,
  effectiveUserId: number,
): Promise<void> {
  const serializedBinding = serializeKemerBetNoTransferReadinessAgentIdentityBinding(
    accountId,
    fingerprint,
    agentProfilePin,
  );
  await assertSafeDirectory(OUTPUT_ROOT, effectiveUserId, 0o700);
  try {
    await lstat(OUTPUT_FILE);
    return unavailable();
  } catch (error) {
    if (!isMissing(error)) return unavailable();
  }
  if (constants.O_DIRECTORY === undefined || constants.O_NOFOLLOW === undefined) unavailable();
  const temporary = `${OUTPUT_ROOT}/.kemerbet_agent_identity_bindings.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  let outputDirectoryHandle: Awaited<ReturnType<typeof open>> | null = null;
  let installedByThisRun = false;
  let installationComplete = false;
  try {
    outputDirectoryHandle = await open(
      OUTPUT_ROOT,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const openedDirectory = (await outputDirectoryHandle.stat()) as SafeStat;
    const namedDirectory = (await lstat(OUTPUT_ROOT)) as SafeStat;
    if (
      !openedDirectory.isDirectory() ||
      openedDirectory.isSymbolicLink() ||
      (openedDirectory.uid !== 0 && openedDirectory.uid !== effectiveUserId) ||
      (openedDirectory.mode & 0o777) !== 0o700 ||
      !namedDirectory.isDirectory() ||
      namedDirectory.isSymbolicLink() ||
      !sameMetadata(openedDirectory, namedDirectory) ||
      (await realpath(OUTPUT_ROOT)) !== OUTPUT_ROOT
    ) {
      return unavailable();
    }
    handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(serializedBinding, { encoding: 'utf8' });
    await handle.sync();
    const written = (await handle.stat()) as SafeStat;
    if (
      !written.isFile() ||
      written.isSymbolicLink() ||
      written.uid !== effectiveUserId ||
      (written.mode & 0o777) !== 0o600 ||
      written.nlink !== 1 ||
      written.size !== EXACT_BINDING_FILE_BYTES
    ) {
      return unavailable();
    }
    await handle.close();
    handle = null;
    await outputDirectoryHandle.sync();
    await link(temporary, OUTPUT_FILE);
    installedByThisRun = true;
    await unlink(temporary);
    await outputDirectoryHandle.sync();
    const installed = (await lstat(OUTPUT_FILE)) as SafeStat;
    if (
      !installed.isFile() ||
      installed.isSymbolicLink() ||
      installed.uid !== effectiveUserId ||
      (installed.mode & 0o777) !== 0o600 ||
      installed.nlink !== 1 ||
      installed.size !== EXACT_BINDING_FILE_BYTES ||
      installed.dev !== written.dev ||
      installed.ino !== written.ino ||
      (await realpath(OUTPUT_FILE)) !== OUTPUT_FILE
    ) {
      return unavailable();
    }
    installationComplete = true;
  } catch {
    return unavailable();
  } finally {
    await handle?.close().catch(() => undefined);
    let directoryChanged = false;
    await unlink(temporary)
      .then(() => {
        directoryChanged = true;
      })
      .catch(() => undefined);
    if (installedByThisRun && !installationComplete) {
      await unlink(OUTPUT_FILE)
        .then(() => {
          directoryChanged = true;
        })
        .catch(() => undefined);
    }
    if (directoryChanged) await outputDirectoryHandle?.sync().catch(() => undefined);
    await outputDirectoryHandle?.close().catch(() => undefined);
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
    const providerAuthorizationDigest = probe.providerAuthorizationDigest();
    if (!PROVIDER_AUTHORIZATION_DIGEST_PATTERN.test(providerAuthorizationDigest)) unavailable();
    const agentProfilePin = `${AGENT_PROFILE_PIN_PREFIX}${probe.observedAgentIdentityFingerprint.slice(
      AGENT_IDENTITY_FINGERPRINT_PREFIX.length,
    )}`;
    if (!AGENT_PROFILE_PIN_PATTERN.test(agentProfilePin)) unavailable();
    reportStage('binding_write');
    await (dependencies.writeBinding ?? writeBindingAtomically)(
      accountId,
      probe.observedAgentIdentityFingerprint,
      agentProfilePin,
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
