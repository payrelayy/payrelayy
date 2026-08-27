import type {
  IncomingHttpHeaders,
  IncomingMessage,
  OutgoingHttpHeaders,
  ServerResponse,
} from 'node:http';
import { constants as fileSystemConstants } from 'node:fs';
import { lstat, open, rename, unlink } from 'node:fs/promises';
import {
  createServer as createHttpsServer,
  request as requestHttps,
  type Server as HttpsServer,
} from 'node:https';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import { createSecureContext, type TLSSocket } from 'node:tls';

import {
  createKemerBetReadinessLayer7AuthorizationVerifier,
  isKemerBetReadinessLayer7Authorization,
  KEMERBET_READINESS_LAYER7_AUTHORIZATION_HEADER,
  loadKemerBetReadinessLayer7AuthorizationMaterial,
  type KemerBetReadinessLayer7AuthorizationReservation,
  type KemerBetReadinessLayer7AuthorizationVerifier,
} from './kemerbet-readiness-layer7-authorization.js';
import {
  publishKemerBetReadinessCompletionReceipt,
  type KemerBetReadinessCompletionReceiptPublisher,
} from './kemerbet-readiness-completion-receipt.js';
import {
  KEMERBET_READINESS_LAYER7_TLS_CERTIFICATE_PEM,
  KEMERBET_READINESS_LAYER7_TLS_HOSTS,
  KEMERBET_READINESS_LAYER7_TLS_PRIVATE_KEY_PEM,
} from './kemerbet-readiness-layer7-certificate.js';
import {
  captureProductionKemerBetReadinessNetworkTopology,
  type KemerBetReadinessNetworkTopology,
} from './kemerbet-readiness-network-gate.js';
import { validateKemerBetReadinessPlayerLookupResponse } from './kemerbet-readiness-player-lookup-response.js';
import {
  KEMERBET_READINESS_AGENT_PROFILE_PATH,
  KEMERBET_READINESS_PROXY_AGENT_IDENTITY_BINDINGS_FILE,
  KEMERBET_READINESS_PROXY_AGENT_IDENTITY_HMAC_KEY_FILE,
  loadKemerBetReadinessSameAgentIdentityVerifier,
  type KemerBetReadinessSameAgentIdentityVerifier,
} from './kemerbet-readiness-same-agent-identity.js';
import {
  KEMERBET_AGENT_API_ORIGIN,
  KEMERBET_AGENT_DEPOSIT_URL,
  KEMERBET_AGENT_PLAYER_LOOKUP_PATH,
} from './playwright-kemerbet-agent-page.js';

/**
 * This deliberately small TLS-terminating proxy is part of the trusted computing base. Its
 * positive path/header policy contains a compromised renderer, but compromise of this process
 * itself cannot be contained at Layer 7 without a second independent TLS-terminating policy layer.
 */
export const KEMERBET_READINESS_LAYER7_RUNTIME_CONTRACT = Object.freeze({
  command: Object.freeze(['node', 'apps/executor/dist/kemerbet-readiness-layer7-proxy.js']),
  environment: Object.freeze([]),
  groupId: 10003,
  host: '0.0.0.0',
  port: 18443,
  secretFiles: Object.freeze([
    '/run/secrets/kemerbet_readiness_proxy_hmac_key',
    '/run/secrets/kemerbet_readiness_proxy_run_nonce',
    '/run/secrets/kemerbet_readiness_release_sha',
    KEMERBET_READINESS_PROXY_AGENT_IDENTITY_BINDINGS_FILE,
    KEMERBET_READINESS_PROXY_AGENT_IDENTITY_HMAC_KEY_FILE,
  ]),
  outputRoot: '/run/output',
  readinessFile: '/tmp/fetanagent-kemerbet-readiness-layer7-proxy.ready',
  userId: 10003,
} as const);

const EXECUTOR_USER_ID = KEMERBET_READINESS_LAYER7_RUNTIME_CONTRACT.userId;
const EXECUTOR_GROUP_ID = KEMERBET_READINESS_LAYER7_RUNTIME_CONTRACT.groupId;
const LISTEN_HOST = KEMERBET_READINESS_LAYER7_RUNTIME_CONTRACT.host;
const LISTEN_PORT = KEMERBET_READINESS_LAYER7_RUNTIME_CONTRACT.port;
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_HEADER_COUNT = 64;
const MAX_UPSTREAM_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_BOOTSTRAP_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_CONCURRENT_UPSTREAM_REQUESTS = 16;
const HEADERS_TIMEOUT_MS = 5_000;
const KEEP_ALIVE_TIMEOUT_MS = 1_000;
const UPSTREAM_TIMEOUT_MS = 10_000;
const MAX_SERIAL_UPSTREAM_OPERATIONS_PER_REQUEST = 2;
const DOWNSTREAM_TIMEOUT_MARGIN_MS = 5_000;
const DOWNSTREAM_REQUEST_TIMEOUT_MS =
  MAX_SERIAL_UPSTREAM_OPERATIONS_PER_REQUEST * UPSTREAM_TIMEOUT_MS + DOWNSTREAM_TIMEOUT_MARGIN_MS;
const DOWNSTREAM_SOCKET_TIMEOUT_MS = DOWNSTREAM_REQUEST_TIMEOUT_MS;
const PLAYER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const PROVIDER_AUTHORIZATION_PATTERN = /^Bearer [A-Za-z0-9._~+\/-]{16,4096}={0,2}$/u;
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;
const AGENT_WEB_HOSTNAME = new URL(KEMERBET_AGENT_DEPOSIT_URL).hostname;
const AGENT_WEB_PATH = new URL(KEMERBET_AGENT_DEPOSIT_URL).pathname;
const AGENT_API_HOSTNAME = new URL(KEMERBET_AGENT_API_ORIGIN).hostname;
const BOOTSTRAP_HOSTNAME = 'agt-client-akm.agent-digi.com';
const AGENT_WEB_ORIGIN = new URL(KEMERBET_AGENT_DEPOSIT_URL).origin;

export const KEMERBET_READINESS_LAYER7_TIMEOUT_CONTRACT = Object.freeze({
  downstreamRequestTimeoutMs: DOWNSTREAM_REQUEST_TIMEOUT_MS,
  downstreamSocketTimeoutMs: DOWNSTREAM_SOCKET_TIMEOUT_MS,
  downstreamTimeoutMarginMs: DOWNSTREAM_TIMEOUT_MARGIN_MS,
  maximumSerialUpstreamOperationsPerRequest: MAX_SERIAL_UPSTREAM_OPERATIONS_PER_REQUEST,
  upstreamOperationTimeoutMs: UPSTREAM_TIMEOUT_MS,
} as const);

export const KEMERBET_READINESS_LAYER7_BOOTSTRAP_ASSET_PATHS = Object.freeze([
  '/prd/agt-admin-client/v84/index-BUEO7OSf.js',
  '/prd/agt-admin-client/v84/index-BnOqIDsD.css',
  '/prd/agt-admin-client/v84/_ltrOffset-C2RQMwco.css',
  '/prd/agt-admin-client/v84/ltr-v1RhStcA.js',
  '/prd/agt-admin-client/v84/ltr-v3JyGz8d.js',
  '/prd/agt-admin-client/v84/index-Bi1Y1r_Z.js',
  '/prd/agt-admin-client/v84/index-6dvVbeUF.js',
] as const);

export const KEMERBET_READINESS_LAYER7_BOOTSTRAP_PREFETCH_CONTRACT = Object.freeze({
  maximumEntryBytes: MAX_UPSTREAM_RESPONSE_BYTES,
  maximumTotalBytes: MAX_BOOTSTRAP_CACHE_BYTES,
  sequence: Object.freeze([
    Object.freeze({ hostname: AGENT_WEB_HOSTNAME, path: AGENT_WEB_PATH }),
    ...KEMERBET_READINESS_LAYER7_BOOTSTRAP_ASSET_PATHS.map((path) =>
      Object.freeze({ hostname: BOOTSTRAP_HOSTNAME, path }),
    ),
  ]),
});

const BOOTSTRAP_ASSET_PATHS = new Set<string>(KEMERBET_READINESS_LAYER7_BOOTSTRAP_ASSET_PATHS);
const TLS_HOSTS = new Set<string>(KEMERBET_READINESS_LAYER7_TLS_HOSTS);
const PREFLIGHT_REQUEST_HEADERS = new Set(['authorization', 'content-type']);
const FIXED_HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const REPORTING_RESPONSE_HEADERS = new Set([
  'alt-svc',
  'content-security-policy-report-only',
  'cross-origin-embedder-policy-report-only',
  'cross-origin-opener-policy-report-only',
  'nel',
  'report-to',
  'reporting-endpoints',
]);
const FIXED_REJECTED_BODY = Buffer.from('{"status":"rejected"}\n', 'utf8');
const FIXED_UNAVAILABLE_BODY = Buffer.from('{"status":"unavailable"}\n', 'utf8');
const FIXED_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const READINESS_FILE = KEMERBET_READINESS_LAYER7_RUNTIME_CONTRACT.readinessFile;
const READINESS_PENDING_FILE = `${READINESS_FILE}.pending`;
const READINESS_BODY = Buffer.from(
  'fetanagent-kemerbet-readiness-layer7-proxy-ready-v1\n',
  'ascii',
);

export type KemerBetReadinessLayer7HeaderBag = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

export type KemerBetReadinessLayer7Classification =
  | { readonly decision: 'reject' }
  | {
      readonly decision: 'local_preflight';
      readonly hostname: string;
      readonly method: 'OPTIONS';
      readonly path: string;
    }
  | {
      readonly decision: 'proxy';
      readonly hostname: string;
      readonly method: 'GET';
      readonly path: string;
      readonly route: 'agent_web' | 'bootstrap_asset' | 'player_lookup';
    };

export interface KemerBetReadinessLayer7ClassifierInput {
  readonly headerCount?: number;
  readonly headers: KemerBetReadinessLayer7HeaderBag;
  readonly isUpgrade?: boolean;
  readonly method: string | undefined;
  readonly rawTarget: string | undefined;
  readonly sniServername: string | false | null | undefined;
}

export interface KemerBetReadinessLayer7UpstreamRequest {
  readonly headers: Readonly<Record<string, string | readonly string[]>>;
  readonly hostname: string;
  readonly method: 'GET';
  readonly path: string;
  readonly signal: AbortSignal;
}

export interface KemerBetReadinessLayer7UpstreamResponse {
  readonly body: Buffer;
  readonly headers: KemerBetReadinessLayer7HeaderBag;
  readonly statusCode: number;
}

export type KemerBetReadinessLayer7Upstream = (
  input: KemerBetReadinessLayer7UpstreamRequest,
) => Promise<KemerBetReadinessLayer7UpstreamResponse>;

export interface KemerBetReadinessLayer7TopologyAttestation {
  readonly egressInterfaceName: string;
  readonly isolatedInterfaceName: string;
}

export interface KemerBetReadinessLayer7ProxyHealth {
  readonly status: 'created' | 'starting' | 'ready' | 'failed' | 'stopped';
}

export interface KemerBetReadinessLayer7ProxyControl {
  readonly server: HttpsServer;
  address(): AddressInfo | string | null;
  bootstrapCacheBytes(): number;
  close(): Promise<void>;
  health(): KemerBetReadinessLayer7ProxyHealth;
  start(): Promise<void>;
}

export interface KemerBetReadinessLayer7ReadinessSignal {
  clear(): Promise<void>;
  publish(): Promise<void>;
}

interface KemerBetReadinessLayer7BootstrapCacheEntry {
  readonly body: Buffer;
  readonly headers: Readonly<Record<string, string>>;
  readonly statusCode: 200;
}

export interface KemerBetReadinessLayer7ProxyOptions {
  readonly allowEphemeralTestPort?: boolean;
  readonly authorizationVerifier: KemerBetReadinessLayer7AuthorizationVerifier;
  readonly captureNetworkTopology?: () => Promise<KemerBetReadinessNetworkTopology>;
  readonly completionReceiptPublisher?: KemerBetReadinessCompletionReceiptPublisher;
  readonly effectiveUserId?: number;
  readonly effectiveGroupId?: number;
  readonly host?: string;
  readonly port?: number;
  readonly readinessSignal?: KemerBetReadinessLayer7ReadinessSignal;
  readonly sameAgentIdentityVerifier: KemerBetReadinessSameAgentIdentityVerifier;
  readonly upstream?: KemerBetReadinessLayer7Upstream;
}

export class KemerBetReadinessLayer7UnavailableError extends Error {
  constructor() {
    super('The KemerBet readiness Layer-7 boundary is unavailable.');
    this.name = 'KemerBetReadinessLayer7UnavailableError';
  }
}

function unavailable(): never {
  throw new KemerBetReadinessLayer7UnavailableError();
}

function headerValues(
  headers: KemerBetReadinessLayer7HeaderBag,
  expectedName: string,
): readonly string[] {
  const result: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== expectedName || value === undefined) continue;
    if (typeof value === 'string') result.push(value);
    else result.push(...value);
  }
  return result;
}

function exactHeaderValue(headers: KemerBetReadinessLayer7HeaderBag, name: string): string | null {
  const values = headerValues(headers, name);
  if (values.length !== 1) return null;
  const value = values[0];
  return value !== undefined && !/[\r\n\0]/u.test(value) ? value : null;
}

function observedHeaderCount(headers: KemerBetReadinessLayer7HeaderBag): number {
  return Object.values(headers).reduce(
    (count, value) => count + (Array.isArray(value) ? value.length : value === undefined ? 0 : 1),
    0,
  );
}

function hasNoRequestBody(headers: KemerBetReadinessLayer7HeaderBag): boolean {
  if (headerValues(headers, 'transfer-encoding').length !== 0) return false;
  if (headerValues(headers, 'expect').length !== 0) return false;
  const contentLengths = headerValues(headers, 'content-length');
  return contentLengths.length === 0 || (contentLengths.length === 1 && contentLengths[0] === '0');
}

function requestsUpgrade(headers: KemerBetReadinessLayer7HeaderBag): boolean {
  if (headerValues(headers, 'upgrade').length !== 0) return true;
  return headerValues(headers, 'connection').some((value) =>
    value
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .includes('upgrade'),
  );
}

function exactPreflight(headers: KemerBetReadinessLayer7HeaderBag): boolean {
  if (
    exactHeaderValue(headers, 'origin') !== AGENT_WEB_ORIGIN ||
    exactHeaderValue(headers, 'access-control-request-method') !== 'GET'
  ) {
    return false;
  }
  const requestedHeaderLine = exactHeaderValue(headers, 'access-control-request-headers');
  if (requestedHeaderLine === null) return false;
  const requestedHeaders = requestedHeaderLine
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== '');
  return (
    requestedHeaders.length >= 1 &&
    new Set(requestedHeaders).size === requestedHeaders.length &&
    requestedHeaders.every((name) => PREFLIGHT_REQUEST_HEADERS.has(name))
  );
}

/** Classify an inbound request without performing DNS, network, file, or logging operations. */
export function classifyKemerBetReadinessLayer7Request(
  input: KemerBetReadinessLayer7ClassifierInput,
): KemerBetReadinessLayer7Classification {
  const reject = Object.freeze({ decision: 'reject' as const });
  const headerCount = input.headerCount ?? observedHeaderCount(input.headers);
  if (
    !Number.isSafeInteger(headerCount) ||
    headerCount < 0 ||
    headerCount > MAX_HEADER_COUNT ||
    input.rawTarget === undefined ||
    input.rawTarget.length < 1 ||
    input.rawTarget.length > 256 ||
    !input.rawTarget.startsWith('/') ||
    /[\r\n\0#]/u.test(input.rawTarget) ||
    !hasNoRequestBody(input.headers) ||
    input.isUpgrade === true ||
    requestsUpgrade(input.headers)
  ) {
    return reject;
  }
  const hostname = exactHeaderValue(input.headers, 'host');
  if (
    hostname === null ||
    !TLS_HOSTS.has(hostname) ||
    input.sniServername !== hostname ||
    (input.method !== 'GET' && input.method !== 'OPTIONS')
  ) {
    return reject;
  }
  if (hostname === AGENT_WEB_HOSTNAME) {
    return input.method === 'GET' &&
      input.rawTarget === AGENT_WEB_PATH &&
      headerValues(input.headers, KEMERBET_READINESS_LAYER7_AUTHORIZATION_HEADER).length === 0
      ? Object.freeze({
          decision: 'proxy' as const,
          hostname,
          method: input.method,
          path: input.rawTarget,
          route: 'agent_web' as const,
        })
      : reject;
  }
  if (hostname === BOOTSTRAP_HOSTNAME) {
    return input.method === 'GET' &&
      BOOTSTRAP_ASSET_PATHS.has(input.rawTarget) &&
      headerValues(input.headers, KEMERBET_READINESS_LAYER7_AUTHORIZATION_HEADER).length === 0
      ? Object.freeze({
          decision: 'proxy' as const,
          hostname,
          method: input.method,
          path: input.rawTarget,
          route: 'bootstrap_asset' as const,
        })
      : reject;
  }
  if (hostname !== AGENT_API_HOSTNAME) return reject;
  const lookupPrefix = `${KEMERBET_AGENT_PLAYER_LOOKUP_PATH}?externalId=`;
  if (!input.rawTarget.startsWith(lookupPrefix)) return reject;
  const playerId = input.rawTarget.slice(lookupPrefix.length);
  const internalAuthorization = exactHeaderValue(
    input.headers,
    KEMERBET_READINESS_LAYER7_AUTHORIZATION_HEADER,
  );
  if (!PLAYER_ID_PATTERN.test(playerId) || input.rawTarget !== `${lookupPrefix}${playerId}`) {
    return reject;
  }
  if (input.method === 'OPTIONS') {
    return internalAuthorization === null && exactPreflight(input.headers)
      ? Object.freeze({
          decision: 'local_preflight' as const,
          hostname,
          method: input.method,
          path: input.rawTarget,
        })
      : reject;
  }
  if (
    !PROVIDER_AUTHORIZATION_PATTERN.test(exactHeaderValue(input.headers, 'authorization') ?? '') ||
    !isKemerBetReadinessLayer7Authorization(internalAuthorization)
  ) {
    return reject;
  }
  return Object.freeze({
    decision: 'proxy' as const,
    hostname,
    method: input.method,
    path: input.rawTarget,
    route: 'player_lookup' as const,
  });
}

function connectionNominatedHeaders(headers: KemerBetReadinessLayer7HeaderBag): Set<string> {
  const result = new Set<string>();
  for (const value of headerValues(headers, 'connection')) {
    for (const token of value.split(',')) {
      const normalized = token.trim().toLowerCase();
      if (HEADER_NAME_PATTERN.test(normalized)) result.add(normalized);
    }
  }
  return result;
}

function sanitizeHeaders(
  headers: KemerBetReadinessLayer7HeaderBag,
  additionalBlockedHeaders: ReadonlySet<string>,
): Readonly<Record<string, string | readonly string[]>> {
  const blocked = new Set([
    ...FIXED_HOP_BY_HOP_HEADERS,
    ...connectionNominatedHeaders(headers),
    ...additionalBlockedHeaders,
  ]);
  const result: Record<string, string | string[]> = {};
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (rawValue === undefined || !HEADER_NAME_PATTERN.test(name) || blocked.has(name)) {
      continue;
    }
    const values = (typeof rawValue === 'string' ? [rawValue] : [...rawValue]).filter(
      (value) => !/[\r\n\0]/u.test(value),
    );
    if (values.length === 0) continue;
    const previous = result[name];
    const merged = [
      ...(previous === undefined ? [] : typeof previous === 'string' ? [previous] : previous),
      ...values,
    ];
    result[name] = merged.length === 1 ? (merged[0] ?? '') : merged;
  }
  return Object.freeze(result);
}

/**
 * Build a route-specific positive request-header set. No renderer-controlled value is forwarded
 * except the bounded bearer credential on an already classified exact Player lookup, and the
 * preflight names whose possible values are themselves a closed set.
 */
export function sanitizeKemerBetReadinessLayer7RequestHeaders(
  headers: KemerBetReadinessLayer7HeaderBag,
  classification: Extract<KemerBetReadinessLayer7Classification, { readonly decision: 'proxy' }>,
): Readonly<Record<string, string | readonly string[]>> {
  if (classification.route === 'agent_web') {
    return Object.freeze({
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-encoding': 'identity',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'none',
      'upgrade-insecure-requests': '1',
      'user-agent': FIXED_USER_AGENT,
    });
  }
  if (classification.route === 'bootstrap_asset') {
    return Object.freeze({
      accept: classification.path.endsWith('.css') ? 'text/css,*/*;q=0.1' : '*/*',
      'accept-encoding': 'identity',
      'sec-fetch-dest': classification.path.endsWith('.css') ? 'style' : 'script',
      'sec-fetch-mode': 'no-cors',
      'sec-fetch-site': 'same-site',
      'user-agent': FIXED_USER_AGENT,
    });
  }
  const authorization = exactHeaderValue(headers, 'authorization');
  if (authorization === null || !PROVIDER_AUTHORIZATION_PATTERN.test(authorization)) {
    return unavailable();
  }
  return Object.freeze({
    accept: 'application/json',
    'accept-encoding': 'identity',
    authorization,
    origin: AGENT_WEB_ORIGIN,
    referer: KEMERBET_AGENT_DEPOSIT_URL,
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'cross-site',
    'user-agent': FIXED_USER_AGENT,
  });
}

/** Build the independent profile request from fixed values plus the exact sanitized bearer. */
export function buildKemerBetReadinessAgentProfileRequestHeaders(
  authorization: string,
): Readonly<Record<string, string>> {
  if (!PROVIDER_AUTHORIZATION_PATTERN.test(authorization)) return unavailable();
  return Object.freeze({
    accept: 'application/json',
    'accept-encoding': 'identity',
    authorization,
    origin: AGENT_WEB_ORIGIN,
    referer: KEMERBET_AGENT_DEPOSIT_URL,
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'cross-site',
    'user-agent': FIXED_USER_AGENT,
  });
}

/** Remove hop-by-hop, alternate-service, browser-reporting, and stale framing response headers. */
export function sanitizeKemerBetReadinessLayer7ResponseHeaders(
  headers: KemerBetReadinessLayer7HeaderBag,
): Readonly<Record<string, string | readonly string[]>> {
  return sanitizeHeaders(headers, new Set(['content-length', ...REPORTING_RESPONSE_HEADERS]));
}

function bootstrapCacheKey(hostname: string, path: string): string {
  return `${hostname}\0${path}`;
}

function fixedBootstrapResponseHeaders(path: string): Readonly<Record<string, string>> {
  if (path === AGENT_WEB_PATH) {
    return Object.freeze({
      'cache-control': 'no-store',
      'content-type': 'text/html; charset=utf-8',
      'x-content-type-options': 'nosniff',
    });
  }
  return Object.freeze({
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
    'content-type': path.endsWith('.css')
      ? 'text/css; charset=utf-8'
      : 'application/javascript; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
}

function clearBootstrapCache(cache: Map<string, KemerBetReadinessLayer7BootstrapCacheEntry>): void {
  for (const entry of cache.values()) entry.body.fill(0);
  cache.clear();
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'ENOENT'
  );
}

async function requireMissingReadinessPath(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (isMissingFile(error)) return;
    return unavailable();
  }
  return unavailable();
}

async function unlinkReadinessPath(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isMissingFile(error)) return unavailable();
  }
}

async function attestProductionReadinessFile(path: string): Promise<void> {
  const content = Buffer.alloc(READINESS_BODY.length + 1);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(path, fileSystemConstants.O_RDONLY | fileSystemConstants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.nlink !== 1 ||
      metadata.uid !== EXECUTOR_USER_ID ||
      metadata.gid !== EXECUTOR_GROUP_ID ||
      (metadata.mode & 0o7777) !== 0o600 ||
      metadata.size !== READINESS_BODY.length
    ) {
      return unavailable();
    }
    const read = await handle.read(content, 0, content.length, 0);
    if (
      read.bytesRead !== READINESS_BODY.length ||
      !content.subarray(0, read.bytesRead).equals(READINESS_BODY)
    ) {
      return unavailable();
    }
  } catch {
    return unavailable();
  } finally {
    content.fill(0);
    await handle?.close().catch(() => undefined);
  }
}

/** Publish the Compose health signal only inside the proxy container's private fresh tmpfs. */
export function createProductionKemerBetReadinessLayer7ReadinessSignal(): KemerBetReadinessLayer7ReadinessSignal {
  let published = false;
  return Object.freeze({
    clear: async () => {
      await unlinkReadinessPath(READINESS_PENDING_FILE);
      await unlinkReadinessPath(READINESS_FILE);
      published = false;
    },
    publish: async () => {
      if (published) return unavailable();
      await requireMissingReadinessPath(READINESS_PENDING_FILE);
      await requireMissingReadinessPath(READINESS_FILE);
      let handle: Awaited<ReturnType<typeof open>> | null = null;
      try {
        handle = await open(
          READINESS_PENDING_FILE,
          fileSystemConstants.O_CREAT |
            fileSystemConstants.O_EXCL |
            fileSystemConstants.O_NOFOLLOW |
            fileSystemConstants.O_WRONLY,
          0o600,
        );
        await handle.writeFile(READINESS_BODY);
        await handle.sync();
      } catch {
        return unavailable();
      } finally {
        await handle?.close().catch(() => undefined);
      }
      await attestProductionReadinessFile(READINESS_PENDING_FILE);
      await rename(READINESS_PENDING_FILE, READINESS_FILE).catch(() => unavailable());
      await attestProductionReadinessFile(READINESS_FILE);
      published = true;
    },
  });
}

const EPHEMERAL_TEST_READINESS_SIGNAL: KemerBetReadinessLayer7ReadinessSignal = Object.freeze({
  clear: async () => undefined,
  publish: async () => undefined,
});

async function prefetchKemerBetReadinessBootstrap(
  upstream: KemerBetReadinessLayer7Upstream,
  signal: AbortSignal,
): Promise<Map<string, KemerBetReadinessLayer7BootstrapCacheEntry>> {
  const cache = new Map<string, KemerBetReadinessLayer7BootstrapCacheEntry>();
  let totalBytes = 0;
  try {
    for (const request of KEMERBET_READINESS_LAYER7_BOOTSTRAP_PREFETCH_CONTRACT.sequence) {
      if (signal.aborted) return unavailable();
      const route = request.hostname === AGENT_WEB_HOSTNAME ? 'agent_web' : 'bootstrap_asset';
      const classification = Object.freeze({
        decision: 'proxy' as const,
        hostname: request.hostname,
        method: 'GET' as const,
        path: request.path,
        route,
      });
      const key = bootstrapCacheKey(request.hostname, request.path);
      if (cache.has(key)) return unavailable();
      const response = await upstream({
        headers: sanitizeKemerBetReadinessLayer7RequestHeaders({}, classification),
        hostname: request.hostname,
        method: 'GET',
        path: request.path,
        signal,
      });
      const contentEncodings = headerValues(response.headers, 'content-encoding');
      if (
        signal.aborted ||
        response.statusCode !== 200 ||
        !Buffer.isBuffer(response.body) ||
        response.body.length < 1 ||
        response.body.length > MAX_UPSTREAM_RESPONSE_BYTES ||
        contentEncodings.length > 1 ||
        (contentEncodings.length === 1 && contentEncodings[0] !== 'identity') ||
        totalBytes > MAX_BOOTSTRAP_CACHE_BYTES - response.body.length
      ) {
        return unavailable();
      }
      const body = Buffer.from(response.body);
      totalBytes += body.length;
      cache.set(
        key,
        Object.freeze({
          body,
          headers: fixedBootstrapResponseHeaders(request.path),
          statusCode: 200 as const,
        }),
      );
    }
    if (
      cache.size !== KEMERBET_READINESS_LAYER7_BOOTSTRAP_PREFETCH_CONTRACT.sequence.length ||
      totalBytes < cache.size ||
      totalBytes > MAX_BOOTSTRAP_CACHE_BYTES
    ) {
      return unavailable();
    }
    return cache;
  } catch {
    return unavailable();
  } finally {
    if (cache.size !== KEMERBET_READINESS_LAYER7_BOOTSTRAP_PREFETCH_CONTRACT.sequence.length) {
      clearBootstrapCache(cache);
    }
  }
}

/**
 * Prove the proxy is dual-homed and that every usable IPv4/IPv6 default route is confined to one
 * of its two interfaces. The other interface is therefore the isolated browser-proxy side.
 */
export function attestKemerBetReadinessLayer7NetworkTopology(
  topology: KemerBetReadinessNetworkTopology,
): KemerBetReadinessLayer7TopologyAttestation {
  const interfaces = [...topology.nonLoopbackInterfaceNames];
  const defaults = [...topology.defaultRouteInterfaceNames];
  if (
    interfaces.length !== 2 ||
    defaults.length !== 1 ||
    new Set(interfaces).size !== 2 ||
    interfaces.some((name) => !/^[A-Za-z0-9_.-]{1,32}$/u.test(name)) ||
    !interfaces.includes(defaults[0] ?? '')
  ) {
    return unavailable();
  }
  const egressInterfaceName = defaults[0] ?? unavailable();
  const isolatedInterfaceName = interfaces.find((name) => name !== egressInterfaceName);
  if (isolatedInterfaceName === undefined) return unavailable();
  return Object.freeze({ egressInterfaceName, isolatedInterfaceName });
}

function sameTopologyAttestation(
  left: KemerBetReadinessLayer7TopologyAttestation,
  right: KemerBetReadinessLayer7TopologyAttestation,
): boolean {
  return (
    left.egressInterfaceName === right.egressInterfaceName &&
    left.isolatedInterfaceName === right.isolatedInterfaceName
  );
}

export async function productionKemerBetReadinessLayer7Upstream(
  input: KemerBetReadinessLayer7UpstreamRequest,
): Promise<KemerBetReadinessLayer7UpstreamResponse> {
  if (input.signal.aborted) return unavailable();
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let responseMessage: IncomingMessage | null = null;
    const fail = () => {
      if (settled) return;
      settled = true;
      responseMessage?.destroy();
      upstreamRequest.destroy();
      rejectPromise(new KemerBetReadinessLayer7UnavailableError());
    };
    const headers: OutgoingHttpHeaders = {
      ...input.headers,
      host: input.hostname,
    };
    const upstreamRequest = requestHttps({
      agent: false,
      headers,
      hostname: input.hostname,
      maxHeaderSize: MAX_HEADER_BYTES,
      method: input.method,
      path: input.path,
      port: 443,
      protocol: 'https:',
      rejectUnauthorized: true,
      servername: input.hostname,
      signal: input.signal,
      timeout: KEMERBET_READINESS_LAYER7_TIMEOUT_CONTRACT.upstreamOperationTimeoutMs,
    });
    const abort = () => fail();
    input.signal.addEventListener('abort', abort, { once: true });
    if (input.signal.aborted) {
      fail();
      return;
    }
    upstreamRequest.once('timeout', fail);
    upstreamRequest.once('error', fail);
    upstreamRequest.once('upgrade', (_response, socket) => {
      socket.destroy();
      fail();
    });
    upstreamRequest.once('response', (response) => {
      responseMessage = response;
      if (
        response.statusCode === undefined ||
        response.statusCode < 200 ||
        response.statusCode > 599 ||
        (response.statusCode >= 300 && response.statusCode <= 399)
      ) {
        fail();
        return;
      }
      const chunks: Buffer[] = [];
      let byteCount = 0;
      response.on('data', (chunk: Buffer | string) => {
        if (settled) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        byteCount += buffer.length;
        if (byteCount > MAX_UPSTREAM_RESPONSE_BYTES) {
          fail();
          return;
        }
        chunks.push(buffer);
      });
      response.once('aborted', fail);
      response.once('error', fail);
      response.once('end', () => {
        if (settled) return;
        const statusCode = response.statusCode;
        if (
          statusCode === undefined ||
          !Number.isSafeInteger(statusCode) ||
          statusCode < 200 ||
          statusCode > 599
        ) {
          fail();
          return;
        }
        settled = true;
        input.signal.removeEventListener('abort', abort);
        resolvePromise(
          Object.freeze({
            body: Buffer.concat(chunks, byteCount),
            headers: response.headersDistinct,
            statusCode,
          }),
        );
      });
    });
    upstreamRequest.end();
  });
}

function fixedResponse(response: ServerResponse, statusCode: number, body: Buffer): void {
  if (response.headersSent || response.destroyed) {
    response.destroy();
    return;
  }
  response.statusCode = statusCode;
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-length', String(body.length));
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('x-content-type-options', 'nosniff');
  response.end(body);
}

function fixedLookupPreflight(response: ServerResponse): void {
  if (response.headersSent || response.destroyed) {
    response.destroy();
    return;
  }
  response.writeHead(204, {
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET',
    'access-control-allow-origin': AGENT_WEB_ORIGIN,
    'cache-control': 'no-store',
    'content-length': '0',
    vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
  });
  response.end();
}

function effectiveUserId(explicitUserId: number | undefined): number {
  if (explicitUserId !== undefined) return explicitUserId;
  return process.geteuid?.() ?? -1;
}

function effectiveGroupId(explicitGroupId: number | undefined): number {
  if (explicitGroupId !== undefined) return explicitGroupId;
  return process.getegid?.() ?? -1;
}

function hasCoherentKemerBetReadinessLayer7TimeoutBudget(): boolean {
  const contract = KEMERBET_READINESS_LAYER7_TIMEOUT_CONTRACT;
  const serialUpstreamBudgetMs =
    contract.maximumSerialUpstreamOperationsPerRequest * contract.upstreamOperationTimeoutMs;
  return (
    Number.isSafeInteger(contract.maximumSerialUpstreamOperationsPerRequest) &&
    contract.maximumSerialUpstreamOperationsPerRequest === 2 &&
    Number.isSafeInteger(contract.upstreamOperationTimeoutMs) &&
    contract.upstreamOperationTimeoutMs > 0 &&
    Number.isSafeInteger(contract.downstreamTimeoutMarginMs) &&
    contract.downstreamTimeoutMarginMs > 0 &&
    Number.isSafeInteger(contract.downstreamRequestTimeoutMs) &&
    contract.downstreamRequestTimeoutMs >=
      serialUpstreamBudgetMs + contract.downstreamTimeoutMarginMs &&
    Number.isSafeInteger(contract.downstreamSocketTimeoutMs) &&
    contract.downstreamSocketTimeoutMs >= contract.downstreamRequestTimeoutMs
  );
}

export function createKemerBetReadinessLayer7Proxy(
  options: KemerBetReadinessLayer7ProxyOptions,
): KemerBetReadinessLayer7ProxyControl {
  const host = options.host ?? LISTEN_HOST;
  const port = options.port ?? LISTEN_PORT;
  const captureNetworkTopology =
    options.captureNetworkTopology ?? captureProductionKemerBetReadinessNetworkTopology;
  const upstream = options.upstream ?? productionKemerBetReadinessLayer7Upstream;
  const completionReceiptPublisher =
    options.completionReceiptPublisher ?? publishKemerBetReadinessCompletionReceipt;
  const readinessSignal =
    options.readinessSignal ??
    (options.allowEphemeralTestPort === true
      ? EPHEMERAL_TEST_READINESS_SIGNAL
      : createProductionKemerBetReadinessLayer7ReadinessSignal());
  const userId = effectiveUserId(options.effectiveUserId);
  const groupId = effectiveGroupId(options.effectiveGroupId);
  if (
    userId !== EXECUTOR_USER_ID ||
    groupId !== EXECUTOR_GROUP_ID ||
    host !== LISTEN_HOST ||
    !Number.isSafeInteger(port) ||
    (port !== LISTEN_PORT && !(port === 0 && options.allowEphemeralTestPort === true)) ||
    !/^[0-9a-f]{64}$/u.test(options.sameAgentIdentityVerifier.agentIdentityBindingSha256) ||
    typeof options.sameAgentIdentityVerifier.verify !== 'function' ||
    typeof options.sameAgentIdentityVerifier.fail !== 'function' ||
    typeof options.sameAgentIdentityVerifier.destroy !== 'function' ||
    typeof readinessSignal.clear !== 'function' ||
    typeof readinessSignal.publish !== 'function' ||
    !hasCoherentKemerBetReadinessLayer7TimeoutBudget()
  ) {
    options.authorizationVerifier.destroy();
    options.sameAgentIdentityVerifier.destroy();
    return unavailable();
  }

  const secureContext = createSecureContext({
    cert: KEMERBET_READINESS_LAYER7_TLS_CERTIFICATE_PEM,
    key: KEMERBET_READINESS_LAYER7_TLS_PRIVATE_KEY_PEM,
  });
  let activeUpstreamRequests = 0;
  let activeLookupController: AbortController | null = null;
  let bootstrapCache = new Map<string, KemerBetReadinessLayer7BootstrapCacheEntry>();
  let startupController: AbortController | null = null;
  let status: KemerBetReadinessLayer7ProxyHealth['status'] = 'created';
  const server = createHttpsServer(
    {
      cert: KEMERBET_READINESS_LAYER7_TLS_CERTIFICATE_PEM,
      headersTimeout: HEADERS_TIMEOUT_MS,
      highWaterMark: 64 * 1024,
      key: KEMERBET_READINESS_LAYER7_TLS_PRIVATE_KEY_PEM,
      keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
      maxHeaderSize: MAX_HEADER_BYTES,
      requestTimeout: KEMERBET_READINESS_LAYER7_TIMEOUT_CONTRACT.downstreamRequestTimeoutMs,
      SNICallback: (servername, callback) => {
        if (TLS_HOSTS.has(servername)) callback(null, secureContext);
        else callback(new KemerBetReadinessLayer7UnavailableError());
      },
    },
    (request, response) => {
      void (async () => {
        const tlsSocket = request.socket as TLSSocket;
        const classification = classifyKemerBetReadinessLayer7Request({
          headerCount: request.rawHeaders.length / 2,
          headers: request.headersDistinct,
          method: request.method,
          rawTarget: request.url,
          sniServername: tlsSocket.servername,
        });
        if (classification.decision === 'reject') {
          fixedResponse(response, 404, FIXED_REJECTED_BODY);
          request.resume();
          return;
        }
        if (classification.decision === 'local_preflight') {
          fixedLookupPreflight(response);
          request.resume();
          return;
        }
        if (classification.route !== 'player_lookup') {
          request.resume();
          const cached = bootstrapCache.get(
            bootstrapCacheKey(classification.hostname, classification.path),
          );
          if (
            status !== 'ready' ||
            cached === undefined ||
            bootstrapCache.size !==
              KEMERBET_READINESS_LAYER7_BOOTSTRAP_PREFETCH_CONTRACT.sequence.length
          ) {
            fixedResponse(response, 502, FIXED_UNAVAILABLE_BODY);
            return;
          }
          response.writeHead(cached.statusCode, {
            ...cached.headers,
            'content-length': String(cached.body.length),
          });
          response.end(cached.body);
          return;
        }
        let lookupReservation: KemerBetReadinessLayer7AuthorizationReservation | null = null;
        const authorization = exactHeaderValue(
          request.headersDistinct,
          KEMERBET_READINESS_LAYER7_AUTHORIZATION_HEADER,
        );
        lookupReservation =
          authorization === null
            ? null
            : options.authorizationVerifier.reserve({
                authorization,
                hostname: classification.hostname,
                method: classification.method,
                path: classification.path,
              });
        if (lookupReservation === null) {
          options.sameAgentIdentityVerifier.fail();
          activeLookupController?.abort();
          fixedResponse(response, 404, FIXED_REJECTED_BODY);
          request.resume();
          return;
        }
        if (activeUpstreamRequests >= MAX_CONCURRENT_UPSTREAM_REQUESTS) {
          if (lookupReservation !== null) {
            options.authorizationVerifier.abort(lookupReservation);
            options.sameAgentIdentityVerifier.fail();
            activeLookupController?.abort();
          }
          fixedResponse(response, 404, FIXED_REJECTED_BODY);
          request.resume();
          return;
        }
        const controller = new AbortController();
        if (lookupReservation !== null) {
          if (activeLookupController !== null) {
            options.authorizationVerifier.abort(lookupReservation);
            options.sameAgentIdentityVerifier.fail();
            activeLookupController.abort();
            fixedResponse(response, 404, FIXED_REJECTED_BODY);
            request.resume();
            return;
          }
          activeLookupController = controller;
        }
        let lookupSettled = false;
        const failLookup = () => {
          if (lookupReservation === null || lookupSettled) return;
          lookupSettled = true;
          options.authorizationVerifier.abort(lookupReservation);
          options.sameAgentIdentityVerifier.fail();
        };
        const abort = () => {
          controller.abort();
          failLookup();
        };
        const closeBeforeFinish = () => {
          if (!response.writableFinished) abort();
        };
        request.once('aborted', abort);
        response.once('close', closeBeforeFinish);
        activeUpstreamRequests += 1;
        try {
          const sanitizedHeaders = sanitizeKemerBetReadinessLayer7RequestHeaders(
            request.headersDistinct,
            classification,
          );
          if (lookupReservation !== null) {
            const providerAuthorization = sanitizedHeaders.authorization;
            if (typeof providerAuthorization !== 'string') return unavailable();
            await options.sameAgentIdentityVerifier.verify({
              authorization: providerAuthorization,
              loadProfile: async (exactAuthorization) => {
                const profileResponse = await upstream({
                  headers: buildKemerBetReadinessAgentProfileRequestHeaders(exactAuthorization),
                  hostname: AGENT_API_HOSTNAME,
                  method: 'GET',
                  path: KEMERBET_READINESS_AGENT_PROFILE_PATH,
                  signal: controller.signal,
                });
                return {
                  body: profileResponse.body,
                  headers: profileResponse.headers,
                  statusCode: profileResponse.statusCode,
                };
              },
            });
            if (controller.signal.aborted) return unavailable();
          }
          const upstreamResponse = await upstream({
            headers: sanitizedHeaders,
            hostname: classification.hostname,
            method: classification.method,
            path: classification.path,
            signal: controller.signal,
          });
          if (
            !Buffer.isBuffer(upstreamResponse.body) ||
            upstreamResponse.body.length > MAX_UPSTREAM_RESPONSE_BYTES ||
            !Number.isSafeInteger(upstreamResponse.statusCode) ||
            upstreamResponse.statusCode < 200 ||
            upstreamResponse.statusCode > 599 ||
            (upstreamResponse.statusCode >= 300 && upstreamResponse.statusCode <= 399)
          ) {
            return unavailable();
          }
          if (
            lookupReservation !== null &&
            !validateKemerBetReadinessPlayerLookupResponse({
              body: upstreamResponse.body,
              requestedPlayerId: lookupReservation.playerId,
              statusCode: upstreamResponse.statusCode,
            })
          ) {
            return unavailable();
          }
          if (response.destroyed) return;
          const responseHeaders = sanitizeKemerBetReadinessLayer7ResponseHeaders(
            upstreamResponse.headers,
          );
          if (lookupReservation === null) {
            response.writeHead(upstreamResponse.statusCode, {
              ...responseHeaders,
              'content-length': String(upstreamResponse.body.length),
            });
            response.end(upstreamResponse.body);
          } else {
            const completion = await new Promise<
              ReturnType<KemerBetReadinessLayer7AuthorizationVerifier['complete']>
            >((resolvePromise, rejectPromise) => {
              const onFinish = () => {
                response.off('error', onError);
                const result = options.authorizationVerifier.complete(lookupReservation);
                lookupSettled = true;
                resolvePromise(result);
              };
              const onError = () => {
                response.off('finish', onFinish);
                rejectPromise(new KemerBetReadinessLayer7UnavailableError());
              };
              response.once('finish', onFinish);
              response.once('error', onError);
              response.writeHead(upstreamResponse.statusCode, {
                ...responseHeaders,
                'content-length': String(upstreamResponse.body.length),
              });
              response.end(upstreamResponse.body);
            });
            if (completion === null) return unavailable();
            if (completion.allCompleted) {
              try {
                await completionReceiptPublisher({
                  agentIdentityBindingSha256:
                    options.sameAgentIdentityVerifier.agentIdentityBindingSha256,
                  releaseSha: options.authorizationVerifier.releaseSha,
                  runNonceSha256: options.authorizationVerifier.runNonceSha256,
                  sameAgentIdentityValidated: true,
                  sequences: Object.freeze([1, 2, 3, 4, 5]),
                });
              } catch {
                options.authorizationVerifier.destroy();
                options.sameAgentIdentityVerifier.destroy();
                return unavailable();
              }
            }
          }
        } finally {
          failLookup();
          activeUpstreamRequests -= 1;
          if (activeLookupController === controller) activeLookupController = null;
          request.off('aborted', abort);
          response.off('close', closeBeforeFinish);
        }
      })().catch(() => fixedResponse(response, 502, FIXED_UNAVAILABLE_BODY));
    },
  );
  server.maxHeadersCount = MAX_HEADER_COUNT;
  server.maxRequestsPerSocket = 32;
  server.setTimeout(
    KEMERBET_READINESS_LAYER7_TIMEOUT_CONTRACT.downstreamSocketTimeoutMs,
    (socket) => socket.destroy(),
  );
  server.on('upgrade', (_request, socket) => socket.destroy());
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('tlsClientError', () => undefined);

  const closeServer = async (): Promise<void> => {
    if (!server.listening) return;
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  };

  const clearReadinessAndCloseServer = async (): Promise<void> => {
    const results = await Promise.allSettled([readinessSignal.clear(), closeServer()]);
    if (results.some(({ status: resultStatus }) => resultStatus === 'rejected')) {
      return unavailable();
    }
  };

  return Object.freeze({
    server,
    address: () => server.address(),
    bootstrapCacheBytes: () =>
      [...bootstrapCache.values()].reduce((total, entry) => total + entry.body.length, 0),
    close: async () => {
      status = 'stopped';
      startupController?.abort();
      try {
        await clearReadinessAndCloseServer();
      } finally {
        clearBootstrapCache(bootstrapCache);
        options.authorizationVerifier.destroy();
        options.sameAgentIdentityVerifier.destroy();
      }
    },
    health: () => Object.freeze({ status }),
    start: async () => {
      if (status !== 'created') return unavailable();
      status = 'starting';
      try {
        await readinessSignal.clear();
        const before = attestKemerBetReadinessLayer7NetworkTopology(await captureNetworkTopology());
        startupController = new AbortController();
        bootstrapCache = await prefetchKemerBetReadinessBootstrap(
          upstream,
          startupController.signal,
        );
        if (startupController.signal.aborted) return unavailable();
        await new Promise<void>((resolvePromise, rejectPromise) => {
          const onError = () => rejectPromise(new KemerBetReadinessLayer7UnavailableError());
          server.once('error', onError);
          server.listen(port, host, () => {
            server.off('error', onError);
            resolvePromise();
          });
        });
        const after = attestKemerBetReadinessLayer7NetworkTopology(await captureNetworkTopology());
        if (!sameTopologyAttestation(before, after)) return unavailable();
        if (
          bootstrapCache.size !==
          KEMERBET_READINESS_LAYER7_BOOTSTRAP_PREFETCH_CONTRACT.sequence.length
        ) {
          return unavailable();
        }
        status = 'ready';
        await readinessSignal.publish();
      } catch {
        status = 'failed';
        startupController?.abort();
        try {
          await clearReadinessAndCloseServer();
        } finally {
          clearBootstrapCache(bootstrapCache);
          options.authorizationVerifier.destroy();
          options.sameAgentIdentityVerifier.destroy();
        }
        return unavailable();
      } finally {
        startupController = null;
      }
    },
  });
}

/** Load only one-run authorization material and start the fixed unprivileged UID/GID proxy. */
export async function startProductionKemerBetReadinessLayer7Proxy(): Promise<KemerBetReadinessLayer7ProxyControl> {
  const userId = effectiveUserId(undefined);
  const groupId = effectiveGroupId(undefined);
  if (userId !== EXECUTOR_USER_ID || groupId !== EXECUTOR_GROUP_ID) return unavailable();
  const authorizationMaterial = await loadKemerBetReadinessLayer7AuthorizationMaterial();
  let authorizationVerifier: KemerBetReadinessLayer7AuthorizationVerifier | null = null;
  let sameAgentIdentityVerifier: KemerBetReadinessSameAgentIdentityVerifier | null = null;
  try {
    sameAgentIdentityVerifier = await loadKemerBetReadinessSameAgentIdentityVerifier({
      effectiveGroupId: groupId,
      effectiveUserId: userId,
    });
    authorizationVerifier =
      createKemerBetReadinessLayer7AuthorizationVerifier(authorizationMaterial);
    const proxy = createKemerBetReadinessLayer7Proxy({
      authorizationVerifier,
      effectiveGroupId: groupId,
      effectiveUserId: userId,
      sameAgentIdentityVerifier,
    });
    authorizationVerifier = null;
    sameAgentIdentityVerifier = null;
    await proxy.start();
    return proxy;
  } catch {
    authorizationVerifier?.destroy();
    sameAgentIdentityVerifier?.destroy();
    return unavailable();
  } finally {
    authorizationMaterial.hmacKey.fill(0);
    authorizationMaterial.runNonce.fill(0);
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  let proxy: KemerBetReadinessLayer7ProxyControl | null = null;
  try {
    proxy = await startProductionKemerBetReadinessLayer7Proxy();
  } catch {
    process.exitCode = 1;
  }
  if (proxy !== null) {
    const close = () => void proxy?.close();
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
  }
}
