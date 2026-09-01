import { createHash, timingSafeEqual } from 'node:crypto';
import { chmod, lstat, mkdir, realpath, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  chromium,
  type BrowserContext,
  type Frame,
  type Page,
  type Route,
  type WebSocketRoute,
} from 'playwright-core';

import {
  KEMERBET_AGENT_LOGIN_RETRY_URL,
  kemerBetEnrollmentAdapter,
} from '@fetanagent/agent-platform-kemerbet';
import {
  KEMERBET_AGENT_IDENTITY_BINDINGS_FILE,
  KEMERBET_AGENT_IDENTITY_HMAC_KEY_FILE,
  KEMERBET_SELECTOR_CONTRACT_FILE,
} from '@fetanagent/config/executor';

import {
  assertKemerBetBrowserExecutable,
  loadKemerBetAgentIdentityBindings,
  loadExactKemerBetImportedReadinessPlayerIds,
  loadKemerBetSessionIdentityAuthorization,
  loadKemerBetSelectorContract,
  type KemerBetSessionIdentityAuthorization,
  type KemerBetExactImportedReadinessPlayers,
} from './executor-runtime-isolation.js';
import {
  createKemerBetAgentIdentityFingerprinter,
  type KemerBetAgentIdentityFingerprinter,
} from './kemerbet-agent-identity-fingerprint.js';
import {
  type KemerBetSingletonArtifactFileSystem,
  purgeKemerBetPersistedServiceWorkerState,
  removeStaleChromiumSingletonArtifacts as removeStaleChromiumSingletonArtifactsFromProfile,
} from './kemerbet-chromium-profile.js';
import { closeKemerBetPersistentBrowserForRestorableCheckpoint } from './kemerbet-persistent-browser-checkpoint.js';
import {
  acquireKemerBetSessionProfileGenerationLease,
  inspectKemerBetSessionProfileGenerationLease,
  KemerBetSessionProfileGenerationQuarantinedError,
  type KemerBetSessionProfileGenerationLease,
  type KemerBetSessionProfileGenerationLeaseInspection,
} from './kemerbet-session-profile-generation-lease.js';
import {
  closeKemerBetReadinessGuardedWebSocket,
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
const READINESS_PLAYER_IDS_FILE = `${CONTROL_ROOT}/kemerbet-readiness-player-ids.stage-v1`;
const PROFILE_ROOT = '/var/lib/fetanagent/kemerbet-sessions';
const CHROMIUM_PATH = '/usr/bin/chromium';
// Playwright 1.62.1 is pinned exactly in apps/executor/package.json. Its one combined
// --disable-features switch must be replaced atomically rather than followed by another switch:
// duplicate Chromium switches can discard the earlier feature list. Keep this list byte-for-byte
// aligned with Playwright 1.62.1, then append FetanAgent's browser-owned network suppressions.
const PLAYWRIGHT_1_62_1_DISABLED_CHROMIUM_FEATURES = Object.freeze([
  'AvoidUnnecessaryBeforeUnloadCheckSync',
  'BoundaryEventDispatchTracksNodeRemoval',
  'DestroyProfileOnBrowserClose',
  'DialMediaRouteProvider',
  'GlobalMediaControls',
  'HttpsUpgrades',
  'LensOverlay',
  'MediaRouter',
  'PaintHolding',
  'ThirdPartyStoragePartitioning',
  'BlockOriginHeaderModificationOnRedirect',
  'Translate',
  'AutoDeElevate',
  'OptimizationHints',
  'msForceBrowserSignIn',
  'msEdgeUpdateLaunchServicesPreferredVersion',
] as const);
const PLAYWRIGHT_1_62_1_DISABLED_CHROMIUM_FEATURES_ARGUMENT = `--disable-features=${PLAYWRIGHT_1_62_1_DISABLED_CHROMIUM_FEATURES.join(',')}`;
const KEMERBET_DISABLED_CHROMIUM_FEATURES_ARGUMENT = `--disable-features=${[
  ...PLAYWRIGHT_1_62_1_DISABLED_CHROMIUM_FEATURES,
  // Chromium Autofill crowdsourcing is browser-owned traffic, not a reviewed KemerBet resource.
  // Suppress it at source; never allowlist content-autofill.googleapis.com in the fail-closed route.
  'AutofillServerCommunication',
  'NetworkPrediction',
  'PreconnectToSearch',
  'SpeculationRulesPrefetchFuture',
  'WebTransport',
].join(',')}`;
const KEMERBET_CHROMIUM_NETWORK_REDUCTION_ARGUMENTS = Object.freeze([
  KEMERBET_DISABLED_CHROMIUM_FEATURES_ARGUMENT,
  '--disable-quic',
  '--dns-prefetch-disable',
  '--disable-network-prediction',
  '--disable-preconnect',
  '--disable-webrtc',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
] as const);
const API_ORIGIN = 'https://admin-api.agt-digi.com';
const DEPOSIT_PATH = '/Wallet/PlayerEPOSDeposit';
const LOGIN_PATH = '/Account/Login';
const REFRESH_TOKEN_PATH = '/Account/RefreshToken';
// SHA-256 of the public reCAPTCHA site key embedded in the independently pinned KemerBet v85
// bundle. Comparing its digest avoids duplicating the key in source or diagnostics while still
// binding the complete one-use reCAPTCHA ceremony to the reviewed KemerBet integration.
const KEMERBET_RECAPTCHA_SITE_KEY_SHA256 =
  '644e0617ffba2393c164eef1f93e6810aae887984eee263e7834dcbf1b5a8863';
const KEMERBET_RECAPTCHA_VERSION = 'ox8dsmiqR62P1bqhciWOn7Fg';
const KEMERBET_RECAPTCHA_ORIGIN_CO = 'aHR0cHM6Ly9hZ2VudHN5c3RlbS5hZG1pbmRpZ2kuY29tOjQ0Mw..';
const KEMERBET_RECAPTCHA_RUNTIME_URL = `https://www.gstatic.com/recaptcha/releases/${KEMERBET_RECAPTCHA_VERSION}/recaptcha__en.js`;
const KEMERBET_RECAPTCHA_STYLES_URL = `https://www.gstatic.com/recaptcha/releases/${KEMERBET_RECAPTCHA_VERSION}/styles__ltr.css`;
const KEMERBET_RECAPTCHA_LOGO_URL = 'https://www.gstatic.com/recaptcha/api2/logo_48.png';
const KEMERBET_RECAPTCHA_WEBWORKER_URL = `https://www.google.com/recaptcha/api2/webworker.js?hl=en&v=${KEMERBET_RECAPTCHA_VERSION}`;
const KEMERBET_RECAPTCHA_OPTIONAL_FONT_URL =
  'https://fonts.gstatic.com/s/roboto/v48/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMa3yUBA.woff2';
const KEMERBET_RECAPTCHA_ASSET_FETCH_TIMEOUT_MS = 10_000;
const KEMERBET_RECAPTCHA_VERIFIED_CACHE_TTL_MS = 10 * 60 * 1_000;
const KEMERBET_RECAPTCHA_VERIFIED_CACHE_MAX_ENTRIES = 5;
const MAX_KEMERBET_CHROMIUM_USER_AGENT_BYTES = 192;
const KEMERBET_CHROMIUM_USER_AGENT_PATTERN =
  /^Mozilla\/5\.0 \((?:X11; Linux x86_64|Windows NT 10\.0; Win64; x64)\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) HeadlessChrome\/[1-9][0-9]{1,2}\.[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6} Safari\/537\.36$/u;
const MAX_RECAPTCHA_RELOAD_BODY_BYTES = 16_384;
const MAX_RECAPTCHA_CLR_BODY_BYTES = 4_096;
const MAX_RECAPTCHA_BCN_BODY_BYTES = 12_288;
const MAX_RECAPTCHA_DYNAMIC_BODY_BYTES =
  MAX_RECAPTCHA_RELOAD_BODY_BYTES + MAX_RECAPTCHA_CLR_BODY_BYTES + MAX_RECAPTCHA_BCN_BODY_BYTES;
const KEMERBET_RECAPTCHA_ASSET_PINS = Object.freeze({
  api: Object.freeze({
    accessControlAllowOrigin: undefined,
    bytes: 1_582,
    crossOriginEmbedderPolicy: undefined,
    crossOriginResourcePolicy: 'cross-origin',
    mime: 'text/javascript',
    sha256: 'e0c02200d83614704ac5381ecb6319282e1f8dfa24e4cc09b6af0a05ee91174a',
  }),
  css: Object.freeze({
    accessControlAllowOrigin: undefined,
    bytes: 82_980,
    crossOriginEmbedderPolicy: undefined,
    crossOriginResourcePolicy: 'cross-origin',
    mime: 'text/css',
    sha256: '13d2b33f69a7c240b4d8a2825b33d638e42bb00a277f9e590da40eb5e639ccbc',
  }),
  logo: Object.freeze({
    accessControlAllowOrigin: undefined,
    bytes: 2_228,
    crossOriginEmbedderPolicy: undefined,
    crossOriginResourcePolicy: 'cross-origin',
    mime: 'image/png',
    sha256: '1b9efb22c938500971aac2b2130a475fa23684dd69e43103894968df83145b8a',
  }),
  runtime: Object.freeze({
    accessControlAllowOrigin: '*',
    bytes: 843_859,
    crossOriginEmbedderPolicy: undefined,
    crossOriginResourcePolicy: 'cross-origin',
    mime: 'text/javascript',
    sha256: '072d298ea24238552d7805174c49bc793d13a12d619d4ceb87c209bbc5c0bd67',
  }),
  webworker: Object.freeze({
    accessControlAllowOrigin: undefined,
    bytes: 102,
    crossOriginEmbedderPolicy: 'require-corp',
    crossOriginResourcePolicy: 'same-site',
    mime: 'text/javascript',
    sha256: 'a41ae6ba81d8d52bd8763a8ea3004297f960f3cfa3f632c761a19fff1d886196',
  }),
});
const KEMERBET_AGENT_WEB_ORIGIN = 'https://agentsystem.admindigi.com';
const KEMERBET_AGENT_BOOTSTRAP_ORIGIN = 'https://agt-client-akm.agent-digi.com';
const KEMERBET_AGENT_BOOTSTRAP_ASSETS = new Map<string, string>([
  ['/prd/agt-admin-client/v85/index-Bb0iEF9d.js', 'script'],
  ['/prd/agt-admin-client/v85/index-CzsfyLxR.css', 'stylesheet'],
  ['/prd/agt-admin-client/v85/_ltrOffset-C2RQMwco.css', 'stylesheet'],
  ['/prd/agt-admin-client/v85/ltr-DYDLRvnG.js', 'script'],
  ['/prd/agt-admin-client/v85/ltr-Dbx7HiAx.js', 'script'],
  ['/prd/agt-admin-client/v85/index-CPiUBAbk.js', 'script'],
  ['/prd/agt-admin-client/v85/index-CQOv3eGS.js', 'script'],
]);
const KEMERBET_ABORTABLE_STATIC_ASSETS = new Map<string, string>([
  [KEMERBET_RECAPTCHA_OPTIONAL_FONT_URL, 'font'],
  [
    'https://agt-cdn.cdn-digi.com/prd/companies/2093/projects/39803/logo_24e4a06149154c9a956062027baa2fed.png',
    'image',
  ],
  ['https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/auth-bg-Dn8uzDgY.svg', 'image'],
  [
    'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/icomoon-CAPnnhhN.ttf?squmb1',
    'font',
  ],
  [
    'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/icomoon-Nwt_l_Rk.eot?squmb1',
    'font',
  ],
  [
    'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/icomoon-B4fQAYPi.woff?squmb1',
    'font',
  ],
  [
    'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/icomoon-BdqDhh2R.svg?squmb1',
    'image',
  ],
  ['https://agentsystem.admindigi.com/src/favicon.svg', 'other'],
  ['https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/en-DC_46aZL.svg', 'image'],
  [
    'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/logo-sign-DirsW9WY.svg',
    'image',
  ],
  [
    'https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,100..900;1,100..900&display=swap',
    'stylesheet',
  ],
]);
const KEMERBET_REQUIRED_STATIC_ASSETS = new Map<string, string>([
  ['https://agt-cdn.cdn-digi.com/prd/system/translations/backoffice_en.json', 'fetch'],
]);
const KEMERBET_AUTHENTICATED_READ_PATHS = new Set([
  '/Account/Info',
  '/Account/Currencies',
  '/SystemLanguage/SystemAvailablePublished',
  '/SystemLanguage/AvailablePublished',
]);
const KEMERBET_OPTIONAL_TELEMETRY_HOSTS = new Set([
  't.cs.hotjar.io',
  'insights.hotjar.com',
  'metrics.hotjar.io',
  'script.hotjar.com',
  'static.hotjar.com',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_BODY_BYTES = 1_024;
const MAX_PROVIDER_REFRESH_BODY_BYTES = 8_192;
const MAX_PROVIDER_LOGIN_BODY_BYTES = 16_384;
const LOGIN_LIFETIME_MS = 10 * 60 * 1_000;
const AUTHENTICATED_SESSION_LIFETIME_MS = 12 * 60 * 60 * 1_000;
const MAX_GENERATION_LIFETIME_MS = LOGIN_LIFETIME_MS + AUTHENTICATED_SESSION_LIFETIME_MS;
const FRAME_CAPTURE_TIMEOUT_MS = 4_000;
const FRAME_REFRESH_INTERVAL_MS = 1_000;
const FAULT_CLEANUP_RETRY_MS = 5_000;
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

export interface KemerBetProvisionAuthenticatedIdentityVerifier {
  readonly accountId: string;
  readonly fingerprintAgentIdentity: KemerBetAgentIdentityFingerprinter;
  verify(page: Page): Promise<void>;
}

export interface KemerBetProvisionAuthenticatedIdentityVerifierDependencies {
  readonly createFingerprinter?: () => Promise<KemerBetAgentIdentityFingerprinter>;
  readonly loadIdentityAuthorization?: () => Promise<KemerBetSessionIdentityAuthorization>;
  readonly loadSelectorContract?: () => Promise<KemerBetAgentPageSelectorContractV2>;
  readonly observeIdentityFingerprint?: typeof observeKemerBetAgentIdentityFingerprint;
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

export interface KemerBetRecaptchaAssetFetchInput {
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly url: string;
  readonly userAgent: string;
}

export interface KemerBetRecaptchaAssetFetchResult {
  readonly accessControlAllowOrigin: string | null;
  readonly body: Uint8Array;
  readonly contentType: string | null;
  readonly crossOriginEmbedderPolicy: string | null;
  readonly crossOriginResourcePolicy: string | null;
  readonly finalUrl: string;
  readonly status: number;
}

export type KemerBetRecaptchaAssetFetcher = (
  input: KemerBetRecaptchaAssetFetchInput,
) => Promise<KemerBetRecaptchaAssetFetchResult>;

interface KemerBetRecaptchaAssetPin {
  readonly accessControlAllowOrigin?: string | undefined;
  readonly bytes: number;
  readonly crossOriginEmbedderPolicy?: string | undefined;
  readonly crossOriginResourcePolicy: string;
  readonly mime: string;
  readonly sha256: string;
}

interface KemerBetRecaptchaAssetPinSet {
  readonly api: KemerBetRecaptchaAssetPin;
  readonly css: KemerBetRecaptchaAssetPin;
  readonly logo: KemerBetRecaptchaAssetPin;
  readonly runtime: KemerBetRecaptchaAssetPin;
  readonly webworker: KemerBetRecaptchaAssetPin;
}

interface KemerBetVerifiedRecaptchaAssetCacheEntry {
  readonly body: Uint8Array;
  readonly expiresAtMonotonicMs: number;
}

const kemerBetVerifiedRecaptchaAssetCache = new Map<
  string,
  KemerBetVerifiedRecaptchaAssetCacheEntry
>();

interface PointerInput {
  readonly frameSequence: number;
  readonly kind: 'pointer';
  readonly platformAgentAccountId: string;
  readonly requestId: string;
  readonly sessionGeneration: string;
  readonly x: number;
  readonly y: number;
}

interface KeyInput {
  readonly frameSequence: number;
  readonly key: string;
  readonly kind: 'key';
  readonly platformAgentAccountId: string;
  readonly requestId: string;
  readonly sessionGeneration: string;
}

interface TextInput {
  readonly frameSequence: number;
  readonly kind: 'text';
  readonly platformAgentAccountId: string;
  readonly requestId: string;
  readonly sessionGeneration: string;
  readonly text: string;
}

type SessionInput = PointerInput | KeyInput | TextInput;

export type KemerBetProvisionSessionPhase =
  | 'authenticated'
  | 'authenticating'
  | 'checkpointed'
  | 'faulted'
  | 'idle'
  | 'login_required'
  | 'starting'
  | 'stopping';

export type KemerBetProvisionStartupStage =
  | 'browser_launch'
  | 'cleanup'
  | 'preflight'
  | 'preview_ready'
  | 'profile'
  | 'provider_asset'
  | 'provider_navigation'
  | 'recaptcha_asset'
  | 'recaptcha_ceremony'
  | 'transport_guard';

export type KemerBetProvisionStartupFailureCode =
  | 'cleanup_unverified'
  | 'contract_mismatch'
  | 'deadline_exceeded'
  | 'dependency_unavailable'
  | 'forbidden_request';

export type KemerBetProvisionStartupStatus = Readonly<{
  readonly detailsRedacted: true;
  readonly failureCode?: KemerBetProvisionStartupFailureCode;
  readonly schemaVersion: 1;
  readonly stage: KemerBetProvisionStartupStage;
  readonly status: 'failed' | 'ready' | 'starting';
}>;

export interface KemerBetProvisionStartupFailureEvent {
  readonly component: 'kemerbet_session_provision';
  readonly detailsRedacted: true;
  readonly event: 'startup_failed';
  readonly failureCode: KemerBetProvisionStartupFailureCode;
  readonly schemaVersion: 1;
  readonly stage: KemerBetProvisionStartupStage;
}

export function createKemerBetProvisionStartupFailureEvent(
  stage: KemerBetProvisionStartupStage,
  failureCode: KemerBetProvisionStartupFailureCode,
): KemerBetProvisionStartupFailureEvent {
  return Object.freeze({
    component: 'kemerbet_session_provision',
    detailsRedacted: true,
    event: 'startup_failed',
    failureCode,
    schemaVersion: 1,
    stage,
  });
}

function createKemerBetProvisionStartupStatus(
  status: 'ready' | 'starting',
  stage: KemerBetProvisionStartupStage,
): KemerBetProvisionStartupStatus;
function createKemerBetProvisionStartupStatus(
  status: 'failed',
  stage: KemerBetProvisionStartupStage,
  failureCode: KemerBetProvisionStartupFailureCode,
): KemerBetProvisionStartupStatus;
function createKemerBetProvisionStartupStatus(
  status: 'failed' | 'ready' | 'starting',
  stage: KemerBetProvisionStartupStage,
  failureCode?: KemerBetProvisionStartupFailureCode,
): KemerBetProvisionStartupStatus {
  return Object.freeze({
    detailsRedacted: true,
    ...(failureCode === undefined ? {} : { failureCode }),
    schemaVersion: 1,
    stage,
    status,
  });
}

export interface KemerBetProvisionSessionStatus {
  readonly active: boolean;
  readonly expiresAt?: string;
  readonly frameSequence?: number;
  readonly generation?: string;
  readonly loginRequired: boolean;
  readonly phase: KemerBetProvisionSessionPhase;
  readonly quarantine?: Readonly<{
    readonly reasonCode:
      'browser_cleanup_unverified' | 'profile_integrity_unverified' | 'unclean_session_generation';
    readonly recoveryRequired: true;
  }>;
  readonly signedIn: boolean;
  readonly startup?: KemerBetProvisionStartupStatus;
  readonly transferDisabled: true;
}

export interface KemerBetProvisionServerDependencies {
  readonly acquireProfileGenerationLease?: (
    profilePath: string,
    effectiveUserId: number,
  ) => Promise<KemerBetSessionProfileGenerationLease>;
  readonly inspectProfileGenerationLease?: (
    profilePath: string,
    effectiveUserId: number,
  ) => Promise<KemerBetSessionProfileGenerationLeaseInspection>;
  readonly inspectProfileGenerationStatus?: (
    accountId: string,
    effectiveUserId: number,
  ) => Promise<KemerBetSessionProfileGenerationLeaseInspection>;
  readonly assertBrowserExecutable?: () => Promise<void>;
  readonly checkpointSignedInPage?: (input: KemerBetSessionCheckpointInput) => Promise<void>;
  readonly createReadinessProbeFromPage?: typeof createKemerBetNoTransferReadinessSealProbeFromPage;
  readonly effectiveUserId?: number;
  readonly environment?: NodeJS.ProcessEnv;
  readonly launchPersistentContext?: typeof chromium.launchPersistentContext;
  readonly loadReadinessPlayerIds?: () => Promise<KemerBetExactImportedReadinessPlayers>;
  readonly monotonicNow?: () => number;
  readonly now?: () => Date;
  readonly prepareSessionProfile?: (accountId: string, effectiveUserId: number) => Promise<string>;
  readonly purgePersistedServiceWorkerState?: (
    profilePath: string,
    effectiveUserId: number,
  ) => Promise<void>;
  readonly prepareAuthenticatedIdentityVerifier?: (
    accountId: string,
    effectiveUserId: number,
  ) => Promise<KemerBetProvisionAuthenticatedIdentityVerifier>;
  readonly runReadinessSeal?: typeof runKemerBetNoTransferReadinessSeal;
  readonly validateSessionProfile?: (profilePath: string, effectiveUserId: number) => Promise<void>;
  readonly setTimer?: typeof setTimeout;
  readonly clearTimer?: typeof clearTimeout;
  readonly forceQuarantine?: (exitCode: 1) => void;
  readonly createRecaptchaCeremony?: typeof createKemerBetRecaptchaCeremony;
  readonly fetchRecaptchaAsset?: KemerBetRecaptchaAssetFetcher;
  readonly closePersistentBrowserForCheckpoint?: typeof closeKemerBetPersistentBrowserForRestorableCheckpoint;
  readonly log?: (event: 'profile_quarantined' | 'started' | 'signed_in' | 'stopped') => void;
  readonly logReadinessSealFailure?: (event: KemerBetReadinessSealFailureEvent) => void;
  readonly logStartupFailure?: (event: KemerBetProvisionStartupFailureEvent) => void;
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
  restored_navigation: true,
  refresh_admitted: true,
  refresh_forwarded: true,
  refresh_response_complete: true,
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

function equalAgentIdentityFingerprints(left: string, right: string): boolean {
  const prefix = 'hmac-sha256-agent-identity-v1:';
  if (!left.startsWith(prefix) || !right.startsWith(prefix)) return false;
  const leftDigest = Buffer.from(left.slice(prefix.length), 'hex');
  const rightDigest = Buffer.from(right.slice(prefix.length), 'hex');
  try {
    return (
      leftDigest.length === 32 &&
      rightDigest.length === 32 &&
      timingSafeEqual(leftDigest, rightDigest)
    );
  } finally {
    leftDigest.fill(0);
    rightDigest.fill(0);
  }
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

/**
 * Inspect an already-existing immutable profile before Start without creating a directory or
 * launching Chromium. A genuinely absent profile is a clean first-use state; every ambiguous
 * filesystem shape remains unavailable.
 */
async function inspectProfileGenerationStatus(
  accountId: string,
  effectiveUserId: number,
): Promise<KemerBetSessionProfileGenerationLeaseInspection> {
  if (!UUID_PATTERN.test(accountId)) unavailable();
  await assertSafeDirectory(PROFILE_ROOT, effectiveUserId);
  const profilePath = resolve(PROFILE_ROOT, accountId);
  if (profilePath !== `${PROFILE_ROOT}/${accountId}`) unavailable();
  try {
    await lstat(profilePath);
  } catch (error) {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      return unavailable();
    }
    await assertSafeDirectory(PROFILE_ROOT, effectiveUserId);
    return Object.freeze({ state: 'clear' });
  }
  await assertSafeDirectory(profilePath, effectiveUserId);
  const inspection = await inspectKemerBetSessionProfileGenerationLease(
    profilePath,
    effectiveUserId,
  );
  await assertSafeDirectory(profilePath, effectiveUserId);
  await assertSafeDirectory(PROFILE_ROOT, effectiveUserId);
  return inspection;
}

function validPageUrl(value: string): 'agents' | 'login' | undefined {
  const classification = kemerBetEnrollmentAdapter.classifyPage(value);
  if (classification.kind === 'authenticated_candidate') return 'agents';
  if (classification.kind === 'login') return 'login';
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
  const [bindings, selectorContract, fingerprintAgentIdentity] = await Promise.all([
    loadKemerBetAgentIdentityBindings({
      effectiveUserId: input.effectiveUserId,
      filePath: KEMERBET_AGENT_IDENTITY_BINDINGS_FILE,
    }),
    loadKemerBetSelectorContract({
      filePath: KEMERBET_SELECTOR_CONTRACT_FILE,
      validate: validateCheckpointSelectorContract,
    }),
    createKemerBetAgentIdentityFingerprinter({
      effectiveUserId: input.effectiveUserId,
      secretFilePath: KEMERBET_AGENT_IDENTITY_HMAC_KEY_FILE,
    }),
  ]);
  if (
    bindings.platformAgentAccountIds.length !== 1 ||
    bindings.platformAgentAccountIds[0] !== input.accountId ||
    bindings.expectedAgentIdentityBindings.size !== 1
  ) {
    return unavailable();
  }
  const expectedFingerprint = bindings.expectedAgentIdentityBindings.get(input.accountId);
  if (!expectedFingerprint) return unavailable();
  const observedFingerprint = await observeKemerBetAgentIdentityFingerprint({
    page: input.page,
    platformAgentAccountId: input.accountId,
    selectorContract,
    fingerprintAgentIdentity,
    timeoutMs: 30_000,
  });
  if (observedFingerprint !== expectedFingerprint) return unavailable();
  const agentPage = createPlaywrightKemerBetAgentPage({
    expectedAgentIdentityFingerprint: expectedFingerprint,
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

/**
 * Load the one immutable external identity binding before the provider browser is allowed online.
 * The raw KemerBet identity never leaves the side-effect-free DOM observer; only its keyed digest
 * is compared with the already sealed binding for the exact active platform-account UUID.
 */
export async function prepareKemerBetProvisionAuthenticatedIdentityVerifier(
  accountId: string,
  effectiveUserId: number,
  dependencies: KemerBetProvisionAuthenticatedIdentityVerifierDependencies = {},
): Promise<KemerBetProvisionAuthenticatedIdentityVerifier> {
  if (
    !UUID_PATTERN.test(accountId) ||
    accountId === '00000000-0000-0000-0000-000000000000' ||
    effectiveUserId !== 10_001
  ) {
    return unavailable();
  }
  const [authorization, selectorContract, fingerprintAgentIdentityWithKey] = await Promise.all([
    dependencies.loadIdentityAuthorization?.() ??
      loadKemerBetSessionIdentityAuthorization({
        effectiveUserId,
        filePath: KEMERBET_AGENT_IDENTITY_BINDINGS_FILE,
      }),
    dependencies.loadSelectorContract?.() ??
      loadKemerBetSelectorContract({
        effectiveUserId,
        filePath: KEMERBET_SELECTOR_CONTRACT_FILE,
        validate: validateCheckpointSelectorContract,
      }),
    dependencies.createFingerprinter?.() ??
      createKemerBetAgentIdentityFingerprinter({
        effectiveUserId,
        secretFilePath: KEMERBET_AGENT_IDENTITY_HMAC_KEY_FILE,
      }),
  ]);
  if (authorization.platformAgentAccountId !== accountId) return unavailable();
  const fingerprintAgentIdentity = ((
    platformAgentAccountId: string,
    rawIdentity: string,
  ): string => {
    if (platformAgentAccountId !== accountId) return unavailable();
    const authorizedFingerprint = fingerprintAgentIdentityWithKey(
      authorization.verificationPlatformAgentAccountId,
      rawIdentity,
    );
    if (
      !equalAgentIdentityFingerprints(
        authorizedFingerprint,
        authorization.expectedAgentIdentityFingerprint,
      )
    ) {
      return unavailable();
    }
    return authorization.verificationPlatformAgentAccountId === accountId
      ? authorizedFingerprint
      : fingerprintAgentIdentityWithKey(accountId, rawIdentity);
  }) as KemerBetAgentIdentityFingerprinter;
  Object.defineProperty(fingerprintAgentIdentity, 'keyFingerprint', {
    configurable: false,
    enumerable: false,
    value: fingerprintAgentIdentityWithKey.keyFingerprint,
    writable: false,
  });
  Object.freeze(fingerprintAgentIdentity);

  return Object.freeze({
    accountId,
    fingerprintAgentIdentity,
    async verify(page: Page): Promise<void> {
      await (dependencies.observeIdentityFingerprint ?? observeKemerBetAgentIdentityFingerprint)({
        fingerprintAgentIdentity,
        page,
        platformAgentAccountId: accountId,
        selectorContract,
      });
    },
  });
}

export type KemerBetSessionRequestDecision = 'abort_optional' | 'allow' | 'forbid';

function normalizedRequestHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(headers ?? {}).map(([name, value]) => [name.toLowerCase(), value.trim()]),
  );
}

function exactProviderUrl(url: URL, origin: string, path: string): boolean {
  return (
    url.protocol === 'https:' &&
    url.origin === origin &&
    url.pathname === path &&
    url.search === '' &&
    url.hash === '' &&
    url.username === '' &&
    url.password === '' &&
    url.port === ''
  );
}

function exactLoginRequest(input: {
  readonly headers?: Readonly<Record<string, string>>;
  readonly isMainFrame: boolean;
  readonly isNavigationRequest: boolean;
  readonly method: string;
  readonly postData?: string | null;
  readonly redirectedFrom?: boolean;
  readonly resourceType?: string;
  readonly url: URL;
}): boolean {
  const headers = normalizedRequestHeaders(input.headers);
  if (
    !input.isMainFrame ||
    input.isNavigationRequest ||
    input.method !== 'POST' ||
    input.resourceType !== 'xhr' ||
    input.redirectedFrom === true ||
    !exactProviderUrl(input.url, API_ORIGIN, LOGIN_PATH) ||
    headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json' ||
    headers.et !== '1' ||
    typeof input.postData !== 'string' ||
    Buffer.byteLength(input.postData, 'utf8') > MAX_PROVIDER_LOGIN_BODY_BYTES
  ) {
    return false;
  }
  try {
    const decoded = JSON.parse(input.postData) as unknown;
    if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return false;
    const object = exactObject(decoded, ['password', 'token', 'userName']);
    if (!object) return false;
    const userName = object.userName;
    const password = object.password;
    const token = object.token;
    return (
      typeof userName === 'string' &&
      userName.length >= 1 &&
      userName.length <= 30 &&
      !/[\u0000-\u001f\u007f]/u.test(userName) &&
      typeof password === 'string' &&
      password.length >= 8 &&
      password.length <= 24 &&
      !/[\u0000-\u001f\u007f]/u.test(password) &&
      typeof token === 'string' &&
      token.length >= 16 &&
      token.length <= 8_192 &&
      !/[\u0000-\u001f\u007f]/u.test(token)
    );
  } catch {
    return false;
  }
}

function exactRefreshRequest(input: {
  readonly headers?: Readonly<Record<string, string>>;
  readonly isMainFrame: boolean;
  readonly isNavigationRequest: boolean;
  readonly method: string;
  readonly postData?: string | null;
  readonly redirectedFrom?: boolean;
  readonly resourceType?: string;
  readonly url: URL;
}): boolean {
  const headers = normalizedRequestHeaders(input.headers);
  if (
    !input.isMainFrame ||
    input.isNavigationRequest ||
    input.method !== 'POST' ||
    input.resourceType !== 'xhr' ||
    input.redirectedFrom === true ||
    !exactProviderUrl(input.url, API_ORIGIN, REFRESH_TOKEN_PATH) ||
    headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json' ||
    headers.et !== '1' ||
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
    const exactGlobalRefreshHeaders =
      headers.grant_type === undefined && headers.authorization === undefined;
    const exactNewServiceRefreshHeaders =
      headers.grant_type === 'refresh_token' &&
      /^Bearer [A-Za-z0-9._~+\/-]{16,4096}={0,2}$/u.test(headers.authorization ?? '');
    return (
      Object.keys(object).length === 1 &&
      typeof refreshToken === 'string' &&
      refreshToken.length >= 16 &&
      refreshToken.length <= 4_096 &&
      !/[\u0000-\u001f\u007f]/u.test(refreshToken) &&
      (exactGlobalRefreshHeaders || exactNewServiceRefreshHeaders)
    );
  } catch {
    return false;
  }
}

function exactCorsPreflight(input: {
  readonly headers?: Readonly<Record<string, string>>;
  readonly pageState: 'agents' | 'login' | undefined;
  readonly url: URL;
}): boolean {
  const headers = normalizedRequestHeaders(input.headers);
  if (headers.origin !== KEMERBET_AGENT_WEB_ORIGIN) return false;
  const requestedMethod = headers['access-control-request-method'];
  const requestedHeaders = (headers['access-control-request-headers'] ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value !== '');
  const exactRequestedHeaders = (...expected: string[]): boolean =>
    requestedHeaders.length === expected.length &&
    new Set(requestedHeaders).size === requestedHeaders.length &&
    [...requestedHeaders].sort().every((name, index) => name === [...expected].sort()[index]);
  if (exactProviderUrl(input.url, API_ORIGIN, LOGIN_PATH)) {
    return (
      input.pageState === 'login' &&
      requestedMethod === 'POST' &&
      exactRequestedHeaders('content-type', 'et')
    );
  }
  if (exactProviderUrl(input.url, API_ORIGIN, REFRESH_TOKEN_PATH)) {
    return (
      input.pageState === 'agents' &&
      requestedMethod === 'POST' &&
      (exactRequestedHeaders('content-type', 'et') ||
        exactRequestedHeaders('authorization', 'content-type', 'et', 'grant_type'))
    );
  }
  return (
    requestedMethod === 'GET' &&
    exactAuthenticatedReadUrl(input) &&
    (input.url.pathname === '/SystemLanguage/SystemAvailablePublished'
      ? exactRequestedHeaders('et')
      : exactRequestedHeaders('authorization', 'content-type'))
  );
}

function exactAuthenticatedReadUrl(input: {
  readonly pageState: 'agents' | 'login' | undefined;
  readonly url: URL;
}): boolean {
  if (!KEMERBET_AUTHENTICATED_READ_PATHS.has(input.url.pathname)) return false;
  if (input.url.pathname === '/SystemLanguage/SystemAvailablePublished') {
    return (
      input.pageState === 'login' && exactProviderUrl(input.url, API_ORIGIN, input.url.pathname)
    );
  }
  if (input.url.pathname === '/SystemLanguage/AvailablePublished') {
    return (
      input.pageState === 'agents' && exactProviderUrl(input.url, API_ORIGIN, input.url.pathname)
    );
  }
  if (input.pageState !== 'agents') return false;
  const query = [...input.url.searchParams.entries()];
  const exactInfoQuery =
    input.url.pathname === '/Account/Info' &&
    query.length === 1 &&
    query[0]?.[0] === 'languageCode' &&
    /^[A-Za-z]{2,3}(?:[-_][A-Za-z]{2,4})?$/u.test(query[0]?.[1] ?? '');
  if (input.url.pathname === '/Account/Info') {
    return (
      exactInfoQuery &&
      input.url.protocol === 'https:' &&
      input.url.origin === API_ORIGIN &&
      input.url.hash === '' &&
      input.url.username === '' &&
      input.url.password === '' &&
      input.url.port === ''
    );
  }
  return exactProviderUrl(input.url, API_ORIGIN, input.url.pathname);
}

function exactAuthenticatedRead(input: {
  readonly headers?: Readonly<Record<string, string>>;
  readonly isMainFrame: boolean;
  readonly pageState: 'agents' | 'login' | undefined;
  readonly redirectedFrom?: boolean;
  readonly resourceType?: string;
  readonly url: URL;
}): boolean {
  const headers = normalizedRequestHeaders(input.headers);
  if (
    !input.isMainFrame ||
    input.redirectedFrom === true ||
    input.resourceType !== 'xhr' ||
    !exactAuthenticatedReadUrl(input)
  ) {
    return false;
  }
  if (input.url.pathname === '/SystemLanguage/SystemAvailablePublished') {
    return (
      headers.et === '1' &&
      headers.authorization === undefined &&
      headers['content-type'] === undefined
    );
  }
  const bearer = /^Bearer [A-Za-z0-9._~+\/-]{16,4096}={0,2}$/u.test(headers.authorization ?? '');
  if (!bearer || headers.et !== undefined) return false;
  return (
    headers['content-type']?.replace(/\s/gu, '').toLowerCase() === 'application/json;charset=utf-8'
  );
}

function exactKemerBetChromiumUserAgent(value: string | undefined): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 96 &&
    value.length <= MAX_KEMERBET_CHROMIUM_USER_AGENT_BYTES &&
    Buffer.byteLength(value, 'utf8') === value.length &&
    KEMERBET_CHROMIUM_USER_AGENT_PATTERN.test(value)
  );
}

function requestKemerBetChromiumUserAgent(
  headers: Readonly<Record<string, string>>,
): string | undefined {
  const candidates = Object.entries(headers).filter(
    ([name]) => name.toLowerCase() === 'user-agent',
  );
  if (candidates.length !== 1) return undefined;
  const value = candidates[0]?.[1];
  return exactKemerBetChromiumUserAgent(value) ? value : undefined;
}

function requestHeaderCount(
  headers: Readonly<Record<string, string>>,
  expectedName: string,
): number {
  return Object.keys(headers).filter((name) => name.toLowerCase() === expectedName).length;
}

function exactRequestHeader(
  headers: Readonly<Record<string, string>>,
  expectedName: string,
  expectedValue: string,
): boolean {
  const candidates = Object.entries(headers).filter(
    ([name]) => name.toLowerCase() === expectedName,
  );
  return candidates.length === 1 && candidates[0]?.[1] === expectedValue;
}

async function fetchKemerBetRecaptchaAsset(
  input: KemerBetRecaptchaAssetFetchInput,
): Promise<KemerBetRecaptchaAssetFetchResult> {
  if (!exactKemerBetChromiumUserAgent(input.userAgent)) return unavailable();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetch(input.url, {
      cache: 'no-store',
      credentials: 'omit',
      headers: { 'user-agent': input.userAgent },
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    if (!reader) return unavailable();
    const declaredLength = response.headers.get('content-length');
    if (
      declaredLength !== null &&
      (!/^(?:0|[1-9][0-9]{0,9})$/u.test(declaredLength) || Number(declaredLength) > input.maxBytes)
    ) {
      controller.abort();
      await reader.cancel().catch(() => undefined);
      return unavailable();
    }
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > input.maxBytes) {
        controller.abort();
        await reader.cancel().catch(() => undefined);
        return unavailable();
      }
      chunks.push(result.value);
    }
    const body = Buffer.allocUnsafe(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return Object.freeze({
      accessControlAllowOrigin: response.headers.get('access-control-allow-origin'),
      body,
      contentType: response.headers.get('content-type'),
      crossOriginEmbedderPolicy: response.headers.get('cross-origin-embedder-policy'),
      crossOriginResourcePolicy: response.headers.get('cross-origin-resource-policy'),
      finalUrl: response.url,
      status: response.status,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizedMime(value: string | null): string | undefined {
  return value?.split(';', 1)[0]?.trim().toLowerCase() || undefined;
}

function verifiedRecaptchaAssetCacheKey(
  url: string,
  pin: KemerBetRecaptchaAssetPin,
  userAgent: string,
): string {
  return [
    url,
    userAgent,
    String(pin.bytes),
    pin.mime,
    pin.sha256,
    pin.accessControlAllowOrigin ?? '',
    pin.crossOriginEmbedderPolicy ?? '',
    pin.crossOriginResourcePolicy,
  ].join('\0');
}

function readVerifiedRecaptchaAssetCache(
  key: string,
  pin: KemerBetRecaptchaAssetPin,
): Buffer | undefined {
  const now = performance.now();
  const cached = kemerBetVerifiedRecaptchaAssetCache.get(key);
  if (!Number.isFinite(now) || !cached) return undefined;
  if (now >= cached.expiresAtMonotonicMs) {
    kemerBetVerifiedRecaptchaAssetCache.delete(key);
    return undefined;
  }
  const body = Buffer.from(cached.body);
  if (
    body.byteLength !== pin.bytes ||
    createHash('sha256').update(body).digest('hex') !== pin.sha256
  ) {
    kemerBetVerifiedRecaptchaAssetCache.delete(key);
    return undefined;
  }
  // Return a copy so neither Playwright nor a future caller can mutate the cached verified bytes.
  return body;
}

function writeVerifiedRecaptchaAssetCache(key: string, body: Buffer): void {
  const now = performance.now();
  if (!Number.isFinite(now)) return;
  for (const [candidateKey, entry] of kemerBetVerifiedRecaptchaAssetCache) {
    if (now >= entry.expiresAtMonotonicMs) {
      kemerBetVerifiedRecaptchaAssetCache.delete(candidateKey);
    }
  }
  if (
    !kemerBetVerifiedRecaptchaAssetCache.has(key) &&
    kemerBetVerifiedRecaptchaAssetCache.size >= KEMERBET_RECAPTCHA_VERIFIED_CACHE_MAX_ENTRIES
  ) {
    const oldestKey = kemerBetVerifiedRecaptchaAssetCache.keys().next().value as string | undefined;
    if (oldestKey !== undefined) kemerBetVerifiedRecaptchaAssetCache.delete(oldestKey);
  }
  kemerBetVerifiedRecaptchaAssetCache.set(
    key,
    Object.freeze({
      body: Uint8Array.from(body),
      expiresAtMonotonicMs: now + KEMERBET_RECAPTCHA_VERIFIED_CACHE_TTL_MS,
    }),
  );
}

function exactRecaptchaSiteKey(value: string, expectedSha256: string): boolean {
  return (
    /^[A-Za-z0-9_-]{40}$/u.test(value) &&
    createHash('sha256').update(value, 'utf8').digest('hex') === expectedSha256
  );
}

function exactRecaptchaUrl(url: URL, origin: string, pathname: string): boolean {
  return (
    url.protocol === 'https:' &&
    url.origin === origin &&
    url.pathname === pathname &&
    url.username === '' &&
    url.password === '' &&
    url.port === '' &&
    url.hash === ''
  );
}

type KemerBetRecaptchaCeremonyStep =
  | 'api'
  | 'runtime_main'
  | 'anchor'
  | 'css'
  | 'static_subresources'
  | 'reload'
  | 'clr'
  | 'bcn'
  | 'complete';

export interface KemerBetRecaptchaCeremony {
  readonly consumeKemerBetLoginPermit: () => Promise<boolean>;
  readonly handleRoute: (input: {
    readonly page: Page;
    readonly requestFrame?: Frame;
    readonly route: Route;
  }) => Promise<'handled' | 'not_recaptcha'>;
  readonly observeMainFrameCommit: (pageUrl: string) => void;
  readonly retireForReauthentication: () => boolean;
}

export function createKemerBetRecaptchaCeremony(input: {
  readonly assetPins?: KemerBetRecaptchaAssetPinSet;
  readonly deadlineMonotonicMs: number;
  readonly deadlineWallClockMs: number;
  readonly expectedSiteKeySha256?: string;
  readonly fetchAsset?: KemerBetRecaptchaAssetFetcher;
  readonly monotonicNow: () => number;
  readonly onForbiddenRequest: (stage: 'recaptcha_asset' | 'recaptcha_ceremony') => void;
  readonly onStage?: (stage: 'recaptcha_asset' | 'recaptcha_ceremony') => void;
  readonly wallClockNow: () => number;
}): KemerBetRecaptchaCeremony {
  const assetPins = input.assetPins ?? KEMERBET_RECAPTCHA_ASSET_PINS;
  const expectedSiteKeySha256 = input.expectedSiteKeySha256 ?? KEMERBET_RECAPTCHA_SITE_KEY_SHA256;
  const fetchAsset = input.fetchAsset ?? fetchKemerBetRecaptchaAsset;
  const useVerifiedProcessCache =
    input.assetPins === undefined &&
    (input.fetchAsset === undefined || input.fetchAsset === fetchKemerBetRecaptchaAsset);
  if (
    !Number.isFinite(input.deadlineMonotonicMs) ||
    input.deadlineMonotonicMs < 0 ||
    !Number.isFinite(input.deadlineWallClockMs) ||
    input.deadlineWallClockMs < 0 ||
    !/^[0-9a-f]{64}$/u.test(expectedSiteKeySha256)
  ) {
    return unavailable();
  }
  for (const pin of Object.values(assetPins)) {
    if (
      !Number.isSafeInteger(pin.bytes) ||
      pin.bytes < 1 ||
      (pin.accessControlAllowOrigin !== undefined && pin.accessControlAllowOrigin !== '*') ||
      (pin.crossOriginEmbedderPolicy !== undefined &&
        pin.crossOriginEmbedderPolicy !== 'require-corp') ||
      !/^(?:cross-origin|same-site)$/u.test(pin.crossOriginResourcePolicy) ||
      !/^[a-z]+\/[a-z0-9.+-]+$/u.test(pin.mime) ||
      !/^[0-9a-f]{64}$/u.test(pin.sha256)
    ) {
      return unavailable();
    }
  }

  let step: KemerBetRecaptchaCeremonyStep = 'api';
  let siteKey: string | undefined;
  let chromiumUserAgent: string | undefined;
  let anchorFrame: Frame | undefined;
  let anchorUrl: string | undefined;
  let anchorRuntimeLoaded = false;
  let logoLoaded = false;
  let webworkerLoaded = false;
  let workerRuntimeLoaded = false;
  let dynamicBodyBytes = 0;
  let ceremonyStarted = false;
  let loginPermitConsumed = false;
  let poisoned = false;
  let retired = false;
  let lane = Promise.resolve();
  const verifiedAssetBodies = new Map<string, Buffer>();

  const observeStage = (stage: 'recaptcha_asset' | 'recaptcha_ceremony'): void => {
    try {
      input.onStage?.(stage);
    } catch {
      // A privacy-safe progress observer cannot weaken the exact ceremony boundary.
    }
  };

  const diagnosticStage = (): 'recaptcha_asset' | 'recaptcha_ceremony' =>
    step === 'api' || step === 'runtime_main' || step === 'css' || step === 'static_subresources'
      ? 'recaptcha_asset'
      : 'recaptcha_ceremony';

  const poison = (): void => {
    if (!poisoned) {
      poisoned = true;
      try {
        input.onForbiddenRequest(diagnosticStage());
      } catch {
        // A redacted attempt counter cannot weaken the local abort boundary.
      }
    }
  };

  const forbidden = async (route: Route): Promise<'handled'> => {
    poison();
    try {
      await route.abort('blockedbyclient');
    } catch {
      // The immutable generation is already poisoned even if Chromium closed the request first.
    }
    return 'handled';
  };

  const beforeDeadline = (): boolean => {
    const monotonicTimestamp = input.monotonicNow();
    const wallTimestamp = input.wallClockNow();
    return (
      Number.isFinite(monotonicTimestamp) &&
      monotonicTimestamp >= 0 &&
      monotonicTimestamp < input.deadlineMonotonicMs &&
      Number.isFinite(wallTimestamp) &&
      wallTimestamp >= 0 &&
      wallTimestamp < input.deadlineWallClockMs
    );
  };

  const fulfillPinnedAsset = async (
    route: Route,
    url: string,
    pin: KemerBetRecaptchaAssetPin,
    userAgent: string,
  ): Promise<boolean> => {
    observeStage('recaptcha_asset');
    const processCacheKey = useVerifiedProcessCache
      ? verifiedRecaptchaAssetCacheKey(url, pin, userAgent)
      : undefined;
    const generationCachedBody = verifiedAssetBodies.get(url);
    let body: Buffer | undefined = generationCachedBody
      ? Buffer.from(generationCachedBody)
      : undefined;
    if (!body && processCacheKey) body = readVerifiedRecaptchaAssetCache(processCacheKey, pin);
    if (!body) {
      const fetched = await fetchAsset({
        maxBytes: pin.bytes,
        timeoutMs: KEMERBET_RECAPTCHA_ASSET_FETCH_TIMEOUT_MS,
        url,
        userAgent,
      });
      body = Buffer.from(fetched.body);
      if (
        poisoned ||
        fetched.finalUrl !== url ||
        fetched.status !== 200 ||
        normalizedMime(fetched.contentType) !== pin.mime ||
        fetched.accessControlAllowOrigin !== (pin.accessControlAllowOrigin ?? null) ||
        fetched.crossOriginEmbedderPolicy !== (pin.crossOriginEmbedderPolicy ?? null) ||
        fetched.crossOriginResourcePolicy !== pin.crossOriginResourcePolicy ||
        body.byteLength !== pin.bytes ||
        createHash('sha256').update(body).digest('hex') !== pin.sha256 ||
        !beforeDeadline()
      ) {
        return false;
      }
      if (processCacheKey) writeVerifiedRecaptchaAssetCache(processCacheKey, body);
    }
    if (poisoned || !beforeDeadline()) return false;
    verifiedAssetBodies.set(url, Buffer.from(body));
    if (poisoned || !beforeDeadline()) return false;
    await route.fulfill({
      body: Buffer.from(body),
      headers: {
        ...(pin.accessControlAllowOrigin === undefined
          ? {}
          : { 'access-control-allow-origin': pin.accessControlAllowOrigin }),
        'cache-control': 'private, no-store, max-age=0',
        'content-length': String(pin.bytes),
        'content-type': pin.mime,
        ...(pin.crossOriginEmbedderPolicy === undefined
          ? {}
          : { 'cross-origin-embedder-policy': pin.crossOriginEmbedderPolicy }),
        'cross-origin-resource-policy': pin.crossOriginResourcePolicy,
        'x-content-type-options': 'nosniff',
      },
      status: 200,
    });
    return !poisoned && beforeDeadline();
  };

  const exactMainFrame = (candidate: Frame | undefined, page: Page): boolean =>
    candidate !== undefined && candidate === page.mainFrame() && candidate.page() === page;

  const exactAnchorFrame = (candidate: Frame | undefined, page: Page): boolean => {
    if (
      candidate === undefined ||
      candidate === page.mainFrame() ||
      candidate.page() !== page ||
      candidate.parentFrame() !== page.mainFrame()
    ) {
      return false;
    }
    return anchorFrame === undefined || anchorFrame === candidate;
  };

  const exactStaticGet = (candidate: {
    readonly expectedResourceType: string;
    readonly expectedUrl: string;
    readonly method: string;
    readonly navigation: boolean;
    readonly redirected: boolean;
    readonly resourceType: string;
    readonly url: URL;
  }): boolean =>
    candidate.method === 'GET' &&
    !candidate.navigation &&
    !candidate.redirected &&
    candidate.resourceType === candidate.expectedResourceType &&
    candidate.url.href === candidate.expectedUrl;

  const exactDynamicPost = (
    request: ReturnType<Route['request']>,
    url: URL,
    page: Page,
    requestFrame: Frame | undefined,
    expectedFrame: 'anchor' | 'main',
    expectedPath: string,
    expectedResourceType: 'fetch' | 'xhr',
    expectedContentType: string | undefined,
    maxBodyBytes: number,
  ): number | undefined => {
    const headers = normalizedRequestHeaders(request.headers());
    const query = [...url.searchParams.entries()];
    const body = request.postDataBuffer();
    if (
      step === 'complete' ||
      !siteKey ||
      !(expectedFrame === 'anchor'
        ? exactAnchorFrame(requestFrame, page)
        : exactMainFrame(requestFrame, page)) ||
      request.method() !== 'POST' ||
      request.isNavigationRequest() ||
      request.redirectedFrom() !== null ||
      request.resourceType() !== expectedResourceType ||
      !exactRecaptchaUrl(url, 'https://www.google.com', expectedPath) ||
      query.length !== 1 ||
      query[0]?.[0] !== 'k' ||
      query[0]?.[1] !== siteKey ||
      url.search !== `?${new URLSearchParams([['k', siteKey]]).toString()}` ||
      (expectedContentType === undefined
        ? headers['content-type'] !== undefined
        : headers['content-type']?.toLowerCase() !== expectedContentType) ||
      !body ||
      body.byteLength < 1 ||
      body.byteLength > maxBodyBytes ||
      dynamicBodyBytes + body.byteLength > MAX_RECAPTCHA_DYNAMIC_BODY_BYTES
    ) {
      return undefined;
    }
    return body.byteLength;
  };

  const handle = async (candidate: {
    readonly page: Page;
    readonly requestFrame?: Frame;
    readonly route: Route;
  }): Promise<'handled' | 'not_recaptcha'> => {
    const request = candidate.route.request();
    let url: URL;
    try {
      url = new URL(request.url());
    } catch {
      return 'not_recaptcha';
    }
    const recaptchaAuthority =
      url.origin === 'https://www.google.com' || url.origin === 'https://www.gstatic.com';
    if (!recaptchaAuthority) return 'not_recaptcha';
    if (
      poisoned ||
      retired ||
      !beforeDeadline() ||
      validPageUrl(candidate.page.url()) !== 'login' ||
      request.url() !== url.href ||
      url.username !== '' ||
      url.password !== '' ||
      url.port !== '' ||
      url.hash !== ''
    ) {
      return forbidden(candidate.route);
    }
    const method = request.method();
    const navigation = request.isNavigationRequest();
    const redirected = request.redirectedFrom() !== null;
    const resourceType = request.resourceType();
    const requestHeaders = request.headers();
    const requestUserAgent = requestKemerBetChromiumUserAgent(requestHeaders);
    // Chromium 152 attributes the exact pinned worker bootstrap to the anchor frame, but
    // Playwright's routed Request omits its browser-owned User-Agent header. Admit that one
    // observed omission only after binding every other immutable property and its exact anchor
    // Referer. The server-side pinned fetch still uses the User-Agent captured from api.js.
    const exactUserAgentOmittedWebworker =
      step === 'static_subresources' &&
      chromiumUserAgent !== undefined &&
      anchorFrame !== undefined &&
      anchorUrl !== undefined &&
      candidate.requestFrame === anchorFrame &&
      requestHeaderCount(requestHeaders, 'user-agent') === 0 &&
      exactRequestHeader(requestHeaders, 'referer', anchorUrl) &&
      exactStaticGet({
        expectedResourceType: 'script',
        expectedUrl: KEMERBET_RECAPTCHA_WEBWORKER_URL,
        method,
        navigation,
        redirected,
        resourceType,
        url,
      });
    const assetFetchUserAgent =
      requestUserAgent ?? (exactUserAgentOmittedWebworker ? chromiumUserAgent : undefined);
    if (
      assetFetchUserAgent === undefined ||
      (requestUserAgent !== undefined &&
        chromiumUserAgent !== undefined &&
        requestUserAgent !== chromiumUserAgent)
    ) {
      return forbidden(candidate.route);
    }
    try {
      if (step === 'api') {
        const query = [...url.searchParams.entries()];
        const nextSiteKey = query.length === 1 && query[0]?.[0] === 'render' ? query[0][1] : '';
        if (
          !exactMainFrame(candidate.requestFrame, candidate.page) ||
          !exactRecaptchaUrl(url, 'https://www.google.com', '/recaptcha/api.js') ||
          !exactStaticGet({
            expectedResourceType: 'script',
            expectedUrl: `https://www.google.com/recaptcha/api.js?render=${nextSiteKey}`,
            method,
            navigation,
            redirected,
            resourceType,
            url,
          }) ||
          !exactRecaptchaSiteKey(nextSiteKey, expectedSiteKeySha256)
        ) {
          return forbidden(candidate.route);
        }
        chromiumUserAgent = assetFetchUserAgent;
        ceremonyStarted = true;
        if (
          !(await fulfillPinnedAsset(candidate.route, url.href, assetPins.api, assetFetchUserAgent))
        ) {
          return forbidden(candidate.route);
        }
        siteKey = nextSiteKey;
        step = 'runtime_main';
        return 'handled';
      }

      if (step === 'runtime_main') {
        if (
          !exactMainFrame(candidate.requestFrame, candidate.page) ||
          !exactStaticGet({
            expectedResourceType: 'script',
            expectedUrl: KEMERBET_RECAPTCHA_RUNTIME_URL,
            method,
            navigation,
            redirected,
            resourceType,
            url,
          })
        ) {
          return forbidden(candidate.route);
        }
        if (
          !(await fulfillPinnedAsset(
            candidate.route,
            url.href,
            assetPins.runtime,
            assetFetchUserAgent,
          ))
        ) {
          return forbidden(candidate.route);
        }
        step = 'anchor';
        return 'handled';
      }

      if (step === 'anchor') {
        observeStage('recaptcha_ceremony');
        const query = [...url.searchParams.entries()];
        const expectedKeys = ['ar', 'k', 'co', 'hl', 'v', 'size', 'anchor-ms', 'execute-ms', 'cb'];
        const exactTiming = (value: string | undefined): boolean =>
          typeof value === 'string' && /^[0-9]{5}$/u.test(value);
        if (
          !siteKey ||
          !exactAnchorFrame(candidate.requestFrame, candidate.page) ||
          method !== 'GET' ||
          !navigation ||
          redirected ||
          resourceType !== 'document' ||
          !exactRecaptchaUrl(url, 'https://www.google.com', '/recaptcha/api2/anchor') ||
          query.length !== expectedKeys.length ||
          query.some(([key], index) => key !== expectedKeys[index]) ||
          url.search !== `?${new URLSearchParams(query).toString()}` ||
          url.searchParams.get('ar') !== '1' ||
          url.searchParams.get('k') !== siteKey ||
          url.searchParams.get('co') !== KEMERBET_RECAPTCHA_ORIGIN_CO ||
          url.searchParams.get('hl') !== 'en' ||
          url.searchParams.get('v') !== KEMERBET_RECAPTCHA_VERSION ||
          url.searchParams.get('size') !== 'invisible' ||
          !exactTiming(url.searchParams.get('anchor-ms') ?? undefined) ||
          !exactTiming(url.searchParams.get('execute-ms') ?? undefined) ||
          !/^[a-z0-9]{12}$/u.test(url.searchParams.get('cb') ?? '')
        ) {
          return forbidden(candidate.route);
        }
        anchorFrame = candidate.requestFrame;
        anchorUrl = url.href;
        if (!beforeDeadline()) return forbidden(candidate.route);
        await candidate.route.continue();
        if (poisoned || !beforeDeadline()) {
          poison();
          return 'handled';
        }
        step = 'css';
        return 'handled';
      }

      if (step === 'css') {
        if (
          candidate.requestFrame !== anchorFrame ||
          !exactStaticGet({
            expectedResourceType: 'stylesheet',
            expectedUrl: KEMERBET_RECAPTCHA_STYLES_URL,
            method,
            navigation,
            redirected,
            resourceType,
            url,
          })
        ) {
          return forbidden(candidate.route);
        }
        if (
          !(await fulfillPinnedAsset(candidate.route, url.href, assetPins.css, assetFetchUserAgent))
        ) {
          return forbidden(candidate.route);
        }
        step = 'static_subresources';
        return 'handled';
      }

      if (step === 'static_subresources') {
        const exactAnchorRuntime =
          candidate.requestFrame === anchorFrame &&
          exactStaticGet({
            expectedResourceType: 'script',
            expectedUrl: KEMERBET_RECAPTCHA_RUNTIME_URL,
            method,
            navigation,
            redirected,
            resourceType,
            url,
          });
        const exactWebworker =
          candidate.requestFrame === anchorFrame &&
          anchorUrl !== undefined &&
          exactRequestHeader(requestHeaders, 'referer', anchorUrl) &&
          exactStaticGet({
            expectedResourceType: 'script',
            expectedUrl: KEMERBET_RECAPTCHA_WEBWORKER_URL,
            method,
            navigation,
            redirected,
            resourceType,
            url,
          });
        const exactLogo =
          candidate.requestFrame === anchorFrame &&
          exactStaticGet({
            expectedResourceType: 'image',
            expectedUrl: KEMERBET_RECAPTCHA_LOGO_URL,
            method,
            navigation,
            redirected,
            resourceType,
            url,
          });
        const exactWorkerRuntime =
          candidate.requestFrame === anchorFrame &&
          exactStaticGet({
            expectedResourceType: 'other',
            expectedUrl: KEMERBET_RECAPTCHA_RUNTIME_URL,
            method,
            navigation,
            redirected,
            resourceType,
            url,
          });
        if (exactAnchorRuntime && !anchorRuntimeLoaded) {
          if (
            !(await fulfillPinnedAsset(
              candidate.route,
              url.href,
              assetPins.runtime,
              assetFetchUserAgent,
            ))
          ) {
            return forbidden(candidate.route);
          }
          anchorRuntimeLoaded = true;
        } else if (exactWebworker && !webworkerLoaded) {
          if (
            !(await fulfillPinnedAsset(
              candidate.route,
              url.href,
              assetPins.webworker,
              assetFetchUserAgent,
            ))
          ) {
            return forbidden(candidate.route);
          }
          webworkerLoaded = true;
        } else if (exactLogo && !logoLoaded) {
          if (
            !(await fulfillPinnedAsset(
              candidate.route,
              url.href,
              assetPins.logo,
              assetFetchUserAgent,
            ))
          ) {
            return forbidden(candidate.route);
          }
          logoLoaded = true;
        } else if (exactWorkerRuntime && webworkerLoaded && !workerRuntimeLoaded) {
          if (
            !(await fulfillPinnedAsset(
              candidate.route,
              url.href,
              assetPins.runtime,
              assetFetchUserAgent,
            ))
          ) {
            return forbidden(candidate.route);
          }
          workerRuntimeLoaded = true;
        } else {
          return forbidden(candidate.route);
        }
        if (anchorRuntimeLoaded && webworkerLoaded && logoLoaded && workerRuntimeLoaded) {
          step = 'reload';
        }
        return 'handled';
      }

      if (step === 'reload') {
        observeStage('recaptcha_ceremony');
        const bytes = exactDynamicPost(
          request,
          url,
          candidate.page,
          candidate.requestFrame,
          'anchor',
          '/recaptcha/api2/reload',
          'xhr',
          'application/x-protobuffer',
          MAX_RECAPTCHA_RELOAD_BODY_BYTES,
        );
        if (bytes === undefined) return forbidden(candidate.route);
        if (!beforeDeadline()) return forbidden(candidate.route);
        await candidate.route.continue();
        if (poisoned || !beforeDeadline()) {
          poison();
          return 'handled';
        }
        dynamicBodyBytes += bytes;
        step = 'clr';
        return 'handled';
      }

      if (step === 'clr') {
        observeStage('recaptcha_ceremony');
        const bytes = exactDynamicPost(
          request,
          url,
          candidate.page,
          candidate.requestFrame,
          'main',
          '/recaptcha/api2/clr',
          'fetch',
          undefined,
          MAX_RECAPTCHA_CLR_BODY_BYTES,
        );
        if (bytes === undefined) return forbidden(candidate.route);
        if (!beforeDeadline()) return forbidden(candidate.route);
        await candidate.route.continue();
        if (poisoned || !beforeDeadline()) {
          poison();
          return 'handled';
        }
        dynamicBodyBytes += bytes;
        step = 'bcn';
        return 'handled';
      }

      if (step === 'bcn') {
        observeStage('recaptcha_ceremony');
        const bytes = exactDynamicPost(
          request,
          url,
          candidate.page,
          candidate.requestFrame,
          'anchor',
          '/recaptcha/api2/bcn',
          'xhr',
          'application/x-protobuf',
          MAX_RECAPTCHA_BCN_BODY_BYTES,
        );
        if (bytes === undefined) return forbidden(candidate.route);
        if (!beforeDeadline()) return forbidden(candidate.route);
        await candidate.route.continue();
        if (poisoned || !beforeDeadline()) {
          poison();
          return 'handled';
        }
        dynamicBodyBytes += bytes;
        step = 'complete';
        return 'handled';
      }
      return forbidden(candidate.route);
    } catch {
      return forbidden(candidate.route);
    }
  };

  const consumeLoginPermit = (): boolean => {
    if (
      poisoned ||
      retired ||
      loginPermitConsumed ||
      step !== 'complete' ||
      !beforeDeadline() ||
      dynamicBodyBytes < 1
    ) {
      poison();
      return false;
    }
    loginPermitConsumed = true;
    return true;
  };

  const enqueue = <T>(operation: () => Promise<T> | T): Promise<T> => {
    const result = lane.then(operation, operation);
    lane = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  return Object.freeze({
    consumeKemerBetLoginPermit: () => enqueue(consumeLoginPermit),
    handleRoute: (candidate: {
      readonly page: Page;
      readonly requestFrame?: Frame;
      readonly route: Route;
    }) => {
      // Do not place unrelated KemerBet application/static traffic behind a large pinned asset
      // download. The exact KemerBet login POST still joins this lane so it cannot overtake the
      // final CAPTCHA beacon that makes the one-use ceremony complete.
      try {
        const request = candidate.route.request();
        const url = new URL(request.url());
        const recaptchaAuthority =
          url.origin === 'https://www.google.com' || url.origin === 'https://www.gstatic.com';
        const kemerBetLogin =
          request.method() === 'POST' && exactProviderUrl(url, API_ORIGIN, LOGIN_PATH);
        if (!recaptchaAuthority && !kemerBetLogin) return Promise.resolve('not_recaptcha' as const);
      } catch {
        return Promise.resolve('not_recaptcha' as const);
      }
      return enqueue(() => handle(candidate));
    },
    observeMainFrameCommit: (pageUrl: string) => {
      const pageState = validPageUrl(pageUrl);
      if (!ceremonyStarted && step === 'api' && siteKey === undefined && !poisoned) {
        if (pageState === 'login' || pageState === 'agents') return;
      }
      if (step === 'complete' && pageState === 'agents' && !poisoned) {
        retired = true;
        return;
      }
      poison();
    },
    retireForReauthentication: () => {
      // Reauthentication may replace only a ceremony that never started (a persisted session
      // opened directly on /agents) or whose sole login permit was already consumed. Never
      // discard an in-flight or reusable proof while swapping the document-bound generation.
      if (
        poisoned ||
        !(
          (!ceremonyStarted && step === 'api' && siteKey === undefined) ||
          (step === 'complete' && loginPermitConsumed)
        )
      ) {
        poison();
        return false;
      }
      retired = true;
      return true;
    },
  });
}

function exactRecaptchaRequest(input: {
  readonly isMainFrame: boolean;
  readonly isNavigationRequest: boolean;
  readonly method: string;
  readonly resourceType?: string;
  readonly url: URL;
}): boolean {
  if (input.url.username !== '' || input.url.password !== '' || input.url.port !== '') return false;
  if (input.url.hash !== '') return false;
  if (input.url.origin === 'https://www.google.com' && input.url.pathname === '/recaptcha/api.js') {
    const query = [...input.url.searchParams.entries()];
    const siteKey = query.length === 1 && query[0]?.[0] === 'render' ? query[0][1] : undefined;
    return (
      !input.isNavigationRequest &&
      input.method === 'GET' &&
      input.resourceType === 'script' &&
      typeof siteKey === 'string' &&
      exactRecaptchaSiteKey(siteKey, KEMERBET_RECAPTCHA_SITE_KEY_SHA256) &&
      input.url.href === `https://www.google.com/recaptcha/api.js?render=${siteKey}`
    );
  }
  // Only the stateful per-generation ceremony above may admit the separately pinned runtime and
  // exact api2 sequence. This stateless classifier deliberately grants no dynamic Google path.
  return false;
}

export function classifyKemerBetSessionRequest(input: {
  readonly headers?: Readonly<Record<string, string>>;
  readonly isMainFrame: boolean;
  readonly isNavigationRequest: boolean;
  readonly method: string;
  readonly pageUrl: string;
  readonly postData?: string | null;
  readonly redirectedFrom?: boolean;
  readonly resourceType?: string;
  readonly requestUrl: string;
}): KemerBetSessionRequestDecision {
  let url: URL;
  try {
    url = new URL(input.requestUrl);
  } catch {
    return 'forbid';
  }
  const pageState = validPageUrl(input.pageUrl);
  if (
    url.protocol !== 'https:' ||
    input.requestUrl !== url.href ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.hash !== '' ||
    url.pathname === DEPOSIT_PATH ||
    url.pathname.startsWith('/Wallet/') ||
    url.pathname.startsWith('/Transaction/')
  ) {
    return 'forbid';
  }
  if (
    (url.hostname === 'send.sentry.report' && url.pathname === '/api/306/envelope/') ||
    KEMERBET_OPTIONAL_TELEMETRY_HOSTS.has(url.hostname)
  ) {
    return 'abort_optional';
  }
  if (
    input.isNavigationRequest &&
    input.isMainFrame &&
    input.method === 'GET' &&
    validPageUrl(url.toString()) !== undefined
  ) {
    return 'allow';
  }
  if (pageState === 'login' && exactRecaptchaRequest({ ...input, url })) return 'allow';
  if (input.isNavigationRequest) return 'forbid';
  if (
    input.method === 'GET' &&
    input.redirectedFrom !== true &&
    url.origin === KEMERBET_AGENT_BOOTSTRAP_ORIGIN &&
    url.search === '' &&
    KEMERBET_AGENT_BOOTSTRAP_ASSETS.get(url.pathname) === input.resourceType
  ) {
    return 'allow';
  }
  if (
    input.method === 'GET' &&
    input.redirectedFrom !== true &&
    KEMERBET_ABORTABLE_STATIC_ASSETS.get(url.href) === input.resourceType
  ) {
    return 'abort_optional';
  }
  if (
    input.method === 'GET' &&
    KEMERBET_REQUIRED_STATIC_ASSETS.get(url.href) === input.resourceType
  ) {
    return 'allow';
  }
  if (pageState === 'login' && exactLoginRequest({ ...input, url })) return 'allow';
  if (pageState === 'agents' && exactRefreshRequest({ ...input, url })) return 'allow';
  if (
    input.method === 'OPTIONS' &&
    exactCorsPreflight({
      ...(input.headers === undefined ? {} : { headers: input.headers }),
      pageState,
      url,
    })
  ) {
    return 'allow';
  }
  if (
    input.method === 'GET' &&
    exactAuthenticatedRead({
      ...(input.headers === undefined ? {} : { headers: input.headers }),
      isMainFrame: input.isMainFrame,
      pageState,
      ...(input.redirectedFrom === undefined ? {} : { redirectedFrom: input.redirectedFrom }),
      ...(input.resourceType === undefined ? {} : { resourceType: input.resourceType }),
      url,
    })
  ) {
    return 'allow';
  }
  return 'forbid';
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
  return classifyKemerBetSessionRequest(input) === 'allow';
}

async function guardedRoute(
  route: Route,
  page: Page,
  recaptchaCeremony: KemerBetRecaptchaCeremony,
  beforeActiveSessionDeadline: () => boolean,
  onActiveSessionDeadlineExceeded: () => void,
  onForbiddenRequest: (stage: 'provider_asset' | 'provider_navigation') => void,
  onProviderRequest: (stage: 'provider_asset' | 'provider_navigation') => void,
): Promise<void> {
  const beforeDeadline = (): boolean => {
    try {
      return beforeActiveSessionDeadline();
    } catch {
      return false;
    }
  };
  const abortForExpiredDeadline = async (): Promise<void> => {
    try {
      onActiveSessionDeadlineExceeded();
    } catch {
      // Deadline enforcement does not depend on the best-effort cleanup scheduler.
    }
    await route.abort('blockedbyclient');
  };
  if (!beforeDeadline()) {
    await abortForExpiredDeadline();
    return;
  }
  const request = route.request();
  let requestBelongsToRetainedPage = false;
  let isMainFrame = false;
  let requestFrame: Frame | undefined;
  try {
    requestFrame = request.frame();
    requestBelongsToRetainedPage = requestFrame.page() === page;
    isMainFrame = requestFrame === page.mainFrame();
  } catch {
    requestBelongsToRetainedPage = false;
  }
  const recaptchaDecision = await recaptchaCeremony.handleRoute({
    page,
    ...(requestFrame === undefined ? {} : { requestFrame }),
    route,
  });
  if (recaptchaDecision === 'handled') return;
  const providerStage = request.isNavigationRequest() ? 'provider_navigation' : 'provider_asset';
  try {
    onProviderRequest(providerStage);
  } catch {
    // A privacy-safe progress observer cannot weaken the exact request boundary.
  }
  const decision = requestBelongsToRetainedPage
    ? classifyKemerBetSessionRequest({
        isMainFrame,
        isNavigationRequest: request.isNavigationRequest(),
        headers: request.headers(),
        method: request.method(),
        pageUrl: page.url(),
        postData: request.postData(),
        redirectedFrom: request.redirectedFrom() !== null,
        resourceType: request.resourceType(),
        requestUrl: request.url(),
      })
    : 'forbid';
  let loginRequest = false;
  try {
    const requestUrl = new URL(request.url());
    loginRequest =
      request.method() === 'POST' && exactProviderUrl(requestUrl, API_ORIGIN, LOGIN_PATH);
  } catch {
    loginRequest = false;
  }
  const loginPermitAccepted =
    decision !== 'allow' || !loginRequest
      ? true
      : await recaptchaCeremony.consumeKemerBetLoginPermit();
  const activeSessionDeadlineAccepted = beforeDeadline();
  if (decision !== 'allow' || !loginPermitAccepted || !activeSessionDeadlineAccepted) {
    if (!activeSessionDeadlineAccepted) {
      await abortForExpiredDeadline();
      return;
    }
    if (decision === 'forbid') {
      try {
        onForbiddenRequest(providerStage);
      } catch {
        // Privacy-safe attempt telemetry cannot weaken the existing local abort boundary.
      }
    }
    await route.abort('blockedbyclient');
    return;
  }
  if (!beforeDeadline()) {
    await abortForExpiredDeadline();
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
    const object = exactObject(value, [
      'frameSequence',
      'kind',
      'platformAgentAccountId',
      'requestId',
      'sessionGeneration',
      'x',
      'y',
    ]);
    return object &&
      typeof object.requestId === 'string' &&
      REQUEST_ID_PATTERN.test(object.requestId) &&
      typeof object.platformAgentAccountId === 'string' &&
      UUID_PATTERN.test(object.platformAgentAccountId) &&
      typeof object.sessionGeneration === 'string' &&
      REQUEST_ID_PATTERN.test(object.sessionGeneration) &&
      Number.isSafeInteger(object.frameSequence) &&
      Number(object.frameSequence) >= 1 &&
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
    const object = exactObject(value, [
      'frameSequence',
      'key',
      'kind',
      'platformAgentAccountId',
      'requestId',
      'sessionGeneration',
    ]);
    const key = object?.key;
    return object &&
      typeof object.requestId === 'string' &&
      REQUEST_ID_PATTERN.test(object.requestId) &&
      typeof object.platformAgentAccountId === 'string' &&
      UUID_PATTERN.test(object.platformAgentAccountId) &&
      typeof object.sessionGeneration === 'string' &&
      REQUEST_ID_PATTERN.test(object.sessionGeneration) &&
      Number.isSafeInteger(object.frameSequence) &&
      Number(object.frameSequence) >= 1 &&
      typeof key === 'string' &&
      (NAMED_KEYS.has(key) || (/^[\u0020-\u007e]$/u.test(key) && key !== '`'))
      ? (object as unknown as KeyInput)
      : undefined;
  }
  if (candidate.kind === 'text') {
    const object = exactObject(value, [
      'frameSequence',
      'kind',
      'platformAgentAccountId',
      'requestId',
      'sessionGeneration',
      'text',
    ]);
    const text = object?.text;
    return object &&
      typeof object.requestId === 'string' &&
      REQUEST_ID_PATTERN.test(object.requestId) &&
      typeof object.platformAgentAccountId === 'string' &&
      UUID_PATTERN.test(object.platformAgentAccountId) &&
      typeof object.sessionGeneration === 'string' &&
      REQUEST_ID_PATTERN.test(object.sessionGeneration) &&
      Number.isSafeInteger(object.frameSequence) &&
      Number(object.frameSequence) >= 1 &&
      typeof text === 'string' &&
      /^[\u0020-\u007e]{1,64}$/u.test(text) &&
      !text.includes('`')
      ? (object as unknown as TextInput)
      : undefined;
  }
  return undefined;
}

function validFrameQuery(value: string | undefined):
  | {
      readonly after: number;
      readonly generation: string;
      readonly platformAgentAccountId: string;
    }
  | undefined {
  if (value === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(value, 'http://session.invalid');
  } catch {
    return undefined;
  }
  if (url.pathname !== '/v1/session/frame' || url.hash !== '') return undefined;
  const keys = [...url.searchParams.keys()].sort();
  if (keys.join('\0') !== ['after', 'generation', 'platformAgentAccountId'].join('\0')) {
    return undefined;
  }
  const generation = url.searchParams.get('generation');
  const afterValue = url.searchParams.get('after');
  const platformAgentAccountId = url.searchParams.get('platformAgentAccountId');
  if (
    generation === null ||
    !REQUEST_ID_PATTERN.test(generation) ||
    afterValue === null ||
    !/^(?:0|[1-9][0-9]{0,9})$/u.test(afterValue) ||
    platformAgentAccountId === null ||
    !UUID_PATTERN.test(platformAgentAccountId)
  ) {
    return undefined;
  }
  const after = Number(afterValue);
  return Number.isSafeInteger(after) ? { after, generation, platformAgentAccountId } : undefined;
}

function validStatusQuery(
  value: string | undefined,
): { readonly platformAgentAccountId: string } | undefined {
  if (value === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(value, 'http://session.invalid');
  } catch {
    return undefined;
  }
  if (url.pathname !== '/v1/session' || url.hash !== '') return undefined;
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== 'platformAgentAccountId') return undefined;
  const platformAgentAccountId = url.searchParams.get('platformAgentAccountId');
  return platformAgentAccountId !== null && UUID_PATTERN.test(platformAgentAccountId)
    ? { platformAgentAccountId }
    : undefined;
}

function sendJpeg(
  response: ServerResponse,
  generation: string,
  sequence: number,
  image: Buffer,
): void {
  response.writeHead(200, {
    'cache-control': 'no-store, max-age=0',
    'content-length': image.byteLength,
    'content-type': 'image/jpeg',
    pragma: 'no-cache',
    'x-fetanagent-frame-sequence': String(sequence),
    'x-fetanagent-session-generation': generation,
  });
  response.end(image);
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
  const acquireProfileGenerationLease =
    dependencies.acquireProfileGenerationLease ?? acquireKemerBetSessionProfileGenerationLease;
  const inspectProfileGenerationLease =
    dependencies.inspectProfileGenerationLease ?? inspectKemerBetSessionProfileGenerationLease;
  const inspectRequestedProfileGenerationStatus =
    dependencies.inspectProfileGenerationStatus ?? inspectProfileGenerationStatus;
  const now = dependencies.now ?? (() => new Date());
  const monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
  const readMonotonicNow = (): number => {
    const timestamp = monotonicNow();
    if (!Number.isFinite(timestamp) || timestamp < 0) return unavailable();
    return timestamp;
  };
  const setTimer = dependencies.setTimer ?? setTimeout;
  const clearTimer = dependencies.clearTimer ?? clearTimeout;
  const closePersistentBrowserForCheckpoint =
    dependencies.closePersistentBrowserForCheckpoint ??
    closeKemerBetPersistentBrowserForRestorableCheckpoint;
  const createReadinessProbeFromPage =
    dependencies.createReadinessProbeFromPage ?? createKemerBetNoTransferReadinessSealProbeFromPage;
  const runReadinessSeal = dependencies.runReadinessSeal ?? runKemerBetNoTransferReadinessSeal;
  const loadReadinessPlayerIds =
    dependencies.loadReadinessPlayerIds ??
    (() =>
      loadExactKemerBetImportedReadinessPlayerIds({
        effectiveUserId,
        filePath: READINESS_PLAYER_IDS_FILE,
      }));
  const checkpointSignedInPage =
    dependencies.checkpointSignedInPage ??
    ((input: KemerBetSessionCheckpointInput) =>
      checkpointKemerBetProvisionSignedInPage({ ...input, effectiveUserId }));
  const prepareAuthenticatedIdentityVerifier =
    dependencies.prepareAuthenticatedIdentityVerifier ??
    prepareKemerBetProvisionAuthenticatedIdentityVerifier;
  const purgePersistedServiceWorkerState =
    dependencies.purgePersistedServiceWorkerState ?? purgeKemerBetPersistedServiceWorkerState;
  const forceQuarantine = dependencies.forceQuarantine ?? ((exitCode: 1) => process.exit(exitCode));
  const buildRecaptchaCeremony =
    dependencies.createRecaptchaCeremony ?? createKemerBetRecaptchaCeremony;
  const fetchRecaptchaAsset = dependencies.fetchRecaptchaAsset ?? fetchKemerBetRecaptchaAsset;
  const validateSessionProfile =
    dependencies.validateSessionProfile ??
    (async (candidateProfilePath: string, candidateEffectiveUserId: number) => {
      await assertSafeDirectory(candidateProfilePath, candidateEffectiveUserId);
      await assertSafeDirectory(PROFILE_ROOT, candidateEffectiveUserId);
    });
  const log =
    dependencies.log ??
    ((event: 'profile_quarantined' | 'started' | 'signed_in' | 'stopped') =>
      console.info({ component: 'kemerbet_session_provision', event, detailsRedacted: true }));
  const logReadinessSealFailure =
    dependencies.logReadinessSealFailure ??
    ((event: KemerBetReadinessSealFailureEvent) => console.error(JSON.stringify(event)));
  const logStartupFailure =
    dependencies.logStartupFailure ??
    ((event: KemerBetProvisionStartupFailureEvent) => console.error(JSON.stringify(event)));
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let profilePath: string | undefined;
  let accountId: string | undefined;
  let expiresAt: Date | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let expiryEpoch = 0;
  let hardDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let hardDeadlineEpoch = 0;
  let signedInLogged = false;
  let authenticatedDeadline: Date | undefined;
  let authenticatedDeadlineMonotonicMs: number | undefined;
  let generationDeadline: Date | undefined;
  let generationDeadlineMonotonicMs: number | undefined;
  let expiresAtMonotonicMs: number | undefined;
  let phase: KemerBetProvisionSessionPhase = 'idle';
  let startupStatus: KemerBetProvisionStartupStatus | undefined;
  let startupFailureCandidate:
    | Readonly<{
        readonly failureCode: KemerBetProvisionStartupFailureCode;
        readonly generation: string;
        readonly stage: KemerBetProvisionStartupStage;
      }>
    | undefined;
  let startupFailureLogged = false;
  let terminalStartupAccountId: string | undefined;
  let terminalStartupRequestId: string | undefined;
  let sessionGeneration: string | undefined;
  let frameSequence = 0;
  let frameImage: Buffer | undefined;
  let frameCapturedAtMs: number | undefined;
  let initializationPromise: Promise<void> | undefined;
  let pendingContext: BrowserContext | undefined;
  let pendingPage: Page | undefined;
  let pendingProfilePath: string | undefined;
  let profileGenerationLease: KemerBetSessionProfileGenerationLease | undefined;
  let pendingProfileGenerationLease: KemerBetSessionProfileGenerationLease | undefined;
  let authenticatedIdentityVerifier: KemerBetProvisionAuthenticatedIdentityVerifier | undefined;
  let identityVerificationPromise: Promise<void> | undefined;
  let identityVerificationEpoch = 0;
  let contextUnexpectedlyClosed = false;
  const expectedContextClosures = new WeakSet<BrowserContext>();
  let checkpointedForRecheck = false;
  let quarantinedAccountId: string | undefined;
  let quarantineReasonCode:
    | 'browser_cleanup_unverified'
    | 'profile_integrity_unverified'
    | 'unclean_session_generation'
    | undefined;
  let blockedRequestCounter = 0n;
  let checkpointValidationActive = false;
  let checkpointBlockedForRecheck = false;
  let faultCleanupGeneration: string | undefined;
  let stopCleanupGeneration: string | undefined;
  let stopCleanupPromise: Promise<void> | undefined;
  const readinessFailure = createKemerBetReadinessSealFailureTracker();
  let lane = Promise.resolve();
  let cleanupLane = Promise.resolve();

  const serialized = async <T>(operation: () => Promise<T>): Promise<T> => {
    const result = lane.then(operation, operation);
    lane = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const serializedCleanup = async (operation: () => Promise<void>): Promise<void> => {
    const result = cleanupLane.then(operation, operation);
    cleanupLane = result.catch(() => undefined);
    return result;
  };

  const reportStartupStage = (generation: string, stage: KemerBetProvisionStartupStage): void => {
    if (
      sessionGeneration !== generation ||
      phase !== 'starting' ||
      startupStatus?.status === 'failed' ||
      startupFailureCandidate !== undefined
    ) {
      return;
    }
    startupStatus = createKemerBetProvisionStartupStatus('starting', stage);
  };

  const reportStartupReady = (generation: string): void => {
    if (
      sessionGeneration !== generation ||
      phase !== 'starting' ||
      startupStatus?.status === 'failed' ||
      startupFailureCandidate !== undefined
    ) {
      return;
    }
    startupStatus = createKemerBetProvisionStartupStatus('ready', 'preview_ready');
  };

  const recordStartupFailure = (
    generation: string,
    stage: KemerBetProvisionStartupStage,
    failureCode: KemerBetProvisionStartupFailureCode,
  ): void => {
    if (
      sessionGeneration !== generation ||
      (startupStatus?.status !== 'starting' && startupStatus?.status !== 'ready') ||
      startupFailureCandidate !== undefined
    ) {
      return;
    }
    startupFailureCandidate = Object.freeze({ failureCode, generation, stage });
  };

  const publishStartupFailure = (
    generation: string,
    override?: Readonly<{
      readonly failureCode: KemerBetProvisionStartupFailureCode;
      readonly stage: KemerBetProvisionStartupStage;
    }>,
  ): void => {
    if (sessionGeneration !== generation || startupStatus?.status === 'failed') return;
    const candidate = override ?? startupFailureCandidate;
    if (!candidate) return;
    startupStatus = createKemerBetProvisionStartupStatus(
      'failed',
      candidate.stage,
      candidate.failureCode,
    );
    terminalStartupAccountId = accountId;
    terminalStartupRequestId = generation;
    startupFailureCandidate = undefined;
    if (startupFailureLogged) return;
    startupFailureLogged = true;
    try {
      logStartupFailure(
        createKemerBetProvisionStartupFailureEvent(candidate.stage, candidate.failureCode),
      );
    } catch {
      // Redacted status and fail-closed cleanup do not depend on diagnostic delivery.
    }
  };

  const cancelExpiry = (): void => {
    if (expiryTimer !== undefined) clearTimer(expiryTimer);
    expiryTimer = undefined;
    expiryEpoch += 1;
  };

  const cancelHardDeadline = (): void => {
    if (hardDeadlineTimer !== undefined) clearTimer(hardDeadlineTimer);
    hardDeadlineTimer = undefined;
    hardDeadlineEpoch += 1;
  };

  const forceQuarantineAtHardDeadline = (generation: string): void => {
    if (
      sessionGeneration !== generation ||
      phase === 'idle' ||
      phase === 'checkpointed' ||
      !generationDeadline ||
      generationDeadlineMonotonicMs === undefined ||
      (now().getTime() < generationDeadline.getTime() &&
        readMonotonicNow() < generationDeadlineMonotonicMs)
    ) {
      return;
    }
    cancelExpiry();
    cancelHardDeadline();
    if (startupStatus?.status === 'starting') {
      publishStartupFailure(generation, {
        failureCode: 'cleanup_unverified',
        stage: 'cleanup',
      });
    }
    checkpointedForRecheck = true;
    phase = 'faulted';
    frameImage = undefined;
    frameCapturedAtMs = undefined;
    identityVerificationEpoch += 1;
    // A context that cannot be proved closed is never reusable. Production exits the dedicated
    // fail-closed coordinator so the outer operator boundary must explicitly re-establish it.
    forceQuarantine(1);
  };

  const armHardDeadline = (generation: string): void => {
    if (
      sessionGeneration !== generation ||
      !generationDeadline ||
      generationDeadlineMonotonicMs === undefined
    ) {
      return unavailable();
    }
    cancelHardDeadline();
    const timerEpoch = hardDeadlineEpoch;
    const hardDeadlineMonotonicMs = generationDeadlineMonotonicMs;
    const hardDeadlineWallMs = generationDeadline.getTime();
    const delayMs = Math.max(
      1,
      Math.min(hardDeadlineWallMs - now().getTime(), hardDeadlineMonotonicMs - readMonotonicNow()),
    );
    hardDeadlineTimer = setTimer(() => {
      if (
        sessionGeneration !== generation ||
        hardDeadlineEpoch !== timerEpoch ||
        phase === 'idle' ||
        phase === 'checkpointed'
      ) {
        return;
      }
      if (now().getTime() < hardDeadlineWallMs && readMonotonicNow() < hardDeadlineMonotonicMs) {
        armHardDeadline(generation);
        return;
      }
      forceQuarantineAtHardDeadline(generation);
    }, delayMs);
  };

  const clearRuntimeState = (
    nextPhase: 'checkpointed' | 'idle',
    preserveStartupFailure = false,
  ): void => {
    cancelExpiry();
    cancelHardDeadline();
    context = undefined;
    page = undefined;
    profilePath = undefined;
    accountId = undefined;
    expiresAt = undefined;
    signedInLogged = false;
    authenticatedDeadline = undefined;
    authenticatedDeadlineMonotonicMs = undefined;
    generationDeadline = undefined;
    generationDeadlineMonotonicMs = undefined;
    expiresAtMonotonicMs = undefined;
    sessionGeneration = undefined;
    frameSequence = 0;
    frameImage = undefined;
    frameCapturedAtMs = undefined;
    pendingContext = undefined;
    pendingPage = undefined;
    pendingProfilePath = undefined;
    profileGenerationLease = undefined;
    pendingProfileGenerationLease = undefined;
    authenticatedIdentityVerifier = undefined;
    identityVerificationPromise = undefined;
    identityVerificationEpoch += 1;
    contextUnexpectedlyClosed = false;
    faultCleanupGeneration = undefined;
    if (!preserveStartupFailure) {
      startupStatus = undefined;
      startupFailureCandidate = undefined;
      startupFailureLogged = false;
      terminalStartupAccountId = undefined;
      terminalStartupRequestId = undefined;
    }
    phase = nextPhase;
  };

  const snapshot = (): KemerBetProvisionSessionStatus => {
    if (phase === 'idle' || phase === 'checkpointed') {
      const inactive = {
        active: false,
        loginRequired: false,
        phase,
        signedIn: false,
        ...(startupStatus === undefined ? {} : { startup: startupStatus }),
        transferDisabled: true,
      } as const;
      if (phase !== 'idle' || quarantineReasonCode === undefined) return inactive;
      return {
        ...inactive,
        quarantine: {
          reasonCode: quarantineReasonCode,
          recoveryRequired: true,
        },
      };
    }
    if (!sessionGeneration || !expiresAt) return unavailable();
    return {
      active: true,
      expiresAt: expiresAt.toISOString(),
      frameSequence,
      generation: sessionGeneration,
      loginRequired: phase === 'login_required',
      phase,
      signedIn: phase === 'authenticated',
      ...(startupStatus === undefined ? {} : { startup: startupStatus }),
      transferDisabled: true,
    };
  };

  const requireExpectedAccountId = (expectedAccountId: string): void => {
    if (!UUID_PATTERN.test(expectedAccountId)) return unavailable();
    if (
      quarantineReasonCode !== undefined &&
      quarantinedAccountId !== undefined &&
      quarantinedAccountId !== expectedAccountId
    ) {
      return unavailable();
    }
    if (
      phase === 'idle' &&
      startupStatus?.status === 'failed' &&
      terminalStartupAccountId !== expectedAccountId
    ) {
      return unavailable();
    }
    if (
      phase !== 'idle' &&
      phase !== 'checkpointed' &&
      (!accountId || accountId !== expectedAccountId)
    ) {
      return unavailable();
    }
  };

  const installInactiveQuarantine = (
    generation: string,
    quarantinedProfileAccountId: string,
    reasonCode:
      'browser_cleanup_unverified' | 'profile_integrity_unverified' | 'unclean_session_generation',
  ): void => {
    if (sessionGeneration !== generation || accountId !== quarantinedProfileAccountId) return;
    checkpointedForRecheck = true;
    clearRuntimeState('idle');
    quarantinedAccountId = quarantinedProfileAccountId;
    quarantineReasonCode = reasonCode;
    log('profile_quarantined');
  };

  const armExpiryAt = (deadline: Date, monotonicDeadlineMs: number, generation: string): void => {
    if (
      !generationDeadline ||
      generationDeadlineMonotonicMs === undefined ||
      generation !== sessionGeneration
    ) {
      return unavailable();
    }
    const deadlineMs = Math.min(deadline.getTime(), generationDeadline.getTime());
    const boundedMonotonicDeadlineMs = Math.min(monotonicDeadlineMs, generationDeadlineMonotonicMs);
    if (!Number.isFinite(deadlineMs) || !Number.isFinite(boundedMonotonicDeadlineMs)) {
      return unavailable();
    }
    cancelExpiry();
    const timerEpoch = expiryEpoch;
    expiresAt = new Date(deadlineMs);
    expiresAtMonotonicMs = boundedMonotonicDeadlineMs;
    const delayMs = Math.max(
      1,
      Math.min(deadlineMs - now().getTime(), boundedMonotonicDeadlineMs - readMonotonicNow()),
    );
    expiryTimer = setTimer(() => {
      void serialized(async () => {
        if (
          sessionGeneration !== generation ||
          expiryEpoch !== timerEpoch ||
          expiresAt?.getTime() !== deadlineMs ||
          expiresAtMonotonicMs !== boundedMonotonicDeadlineMs ||
          phase === 'idle' ||
          phase === 'checkpointed'
        ) {
          return;
        }
        if (now().getTime() < deadlineMs && readMonotonicNow() < boundedMonotonicDeadlineMs) {
          armExpiryAt(new Date(deadlineMs), boundedMonotonicDeadlineMs, generation);
          return;
        }
        beginStop();
      });
    }, delayMs);
  };

  const armExpiry = (lifetimeMs: number, generation: string): void => {
    armExpiryAt(
      new Date(now().getTime() + lifetimeMs),
      readMonotonicNow() + lifetimeMs,
      generation,
    );
  };

  const scheduleFaultCleanupRetry = (generation: string): void => {
    const hardDeadlineMonotonicMs = generationDeadlineMonotonicMs;
    const hardDeadlineWallMs = generationDeadline?.getTime();
    if (
      hardDeadlineWallMs === undefined ||
      hardDeadlineMonotonicMs === undefined ||
      now().getTime() >= hardDeadlineWallMs ||
      readMonotonicNow() >= hardDeadlineMonotonicMs
    ) {
      forceQuarantineAtHardDeadline(generation);
      return;
    }
    cancelExpiry();
    const timerEpoch = expiryEpoch;
    const retryAtWallMs = Math.min(now().getTime() + FAULT_CLEANUP_RETRY_MS, hardDeadlineWallMs);
    const retryAtMonotonicMs = Math.min(
      readMonotonicNow() + FAULT_CLEANUP_RETRY_MS,
      hardDeadlineMonotonicMs,
    );
    expiryTimer = setTimer(
      () => {
        if (sessionGeneration !== generation || expiryEpoch !== timerEpoch || phase !== 'faulted') {
          return;
        }
        if (
          now().getTime() >= hardDeadlineWallMs ||
          readMonotonicNow() >= hardDeadlineMonotonicMs
        ) {
          forceQuarantineAtHardDeadline(generation);
          return;
        }
        void serialized(async () => {
          if (sessionGeneration === generation && phase === 'faulted') beginStop();
        });
      },
      Math.max(
        1,
        Math.min(retryAtWallMs - now().getTime(), retryAtMonotonicMs - readMonotonicNow()),
      ),
    );
  };

  const closeBrowserCleanly = async (
    retainedContext: BrowserContext,
    retainedPage: Page,
    retainedProfilePath: string,
  ): Promise<void> => {
    expectedContextClosures.add(retainedContext);
    try {
      await closePersistentBrowserForCheckpoint(
        {
          context: retainedContext,
          effectiveUserId,
          page: retainedPage,
          profilePath: retainedProfilePath,
        },
        { clearTimer, setTimer },
      );
    } catch (error) {
      expectedContextClosures.delete(retainedContext);
      throw error;
    }
  };

  const finishStop = async (generation: string): Promise<void> => {
    if (sessionGeneration !== generation || phase !== 'stopping') return;
    const inFlight = initializationPromise;
    if (inFlight !== undefined) await inFlight;
    // The initializer may itself finish a proven-clean causal-failure teardown while this stop
    // operation is waiting for it. Never let the stale continuation clear or close a newer
    // generation admitted after that terminal result became observable.
    if (sessionGeneration !== generation || phase !== 'stopping') return;
    const retainedContext = context ?? pendingContext;
    const retainedPage = page ?? pendingPage;
    const retainedProfilePath = profilePath ?? pendingProfilePath;
    const retainedProfileGenerationLease = profileGenerationLease ?? pendingProfileGenerationLease;
    const retainedContextAlreadyClosed = contextUnexpectedlyClosed;
    let forcedContextClose = false;
    try {
      if (retainedContext && retainedPage?.isClosed() === true && !retainedContextAlreadyClosed) {
        // A closed Page is not evidence that its BrowserContext, workers, or sibling targets are
        // gone. Terminate the whole context and irreversibly quarantine this in-process profile
        // generation because it can no longer produce a restorable clean checkpoint.
        await retainedContext.close();
        forcedContextClose = true;
      } else if (
        retainedContext &&
        retainedPage &&
        retainedProfilePath &&
        !retainedContextAlreadyClosed
      ) {
        await closeBrowserCleanly(retainedContext, retainedPage, retainedProfilePath);
        if (!retainedProfileGenerationLease) return unavailable();
        await retainedProfileGenerationLease.releaseAfterCleanCheckpoint();
      } else if (retainedContext && !retainedContextAlreadyClosed) {
        await retainedContext.close();
        forcedContextClose = true;
      } else if (retainedProfileGenerationLease) {
        // A process may have failed during launch before exposing a context. Without an exact
        // Chromium clean-exit attestation, retain the durable marker and quarantine the revision.
        forcedContextClose = true;
      }
    } catch {
      if (startupFailureCandidate?.generation === generation) {
        publishStartupFailure(generation, {
          failureCode: 'cleanup_unverified',
          stage: 'cleanup',
        });
      }
      phase = 'faulted';
      frameImage = undefined;
      frameCapturedAtMs = undefined;
      // Keep retrying cleanup at a bounded cadence without extending or replacing the immutable
      // session deadline. A failed Chromium close must never strand the provision lane forever.
      scheduleFaultCleanupRetry(generation);
      return;
    }
    if (forcedContextClose) checkpointedForRecheck = true;
    if (startupFailureCandidate?.generation === generation) {
      if (forcedContextClose) {
        publishStartupFailure(generation, {
          failureCode: 'cleanup_unverified',
          stage: 'cleanup',
        });
      } else {
        publishStartupFailure(generation);
      }
    }
    const preserveStartupFailure = startupStatus?.status === 'failed';
    clearRuntimeState('idle', preserveStartupFailure);
    if (retainedContext) log('stopped');
  };

  const queueStopCleanup = (generation: string): void => {
    if (stopCleanupGeneration === generation && stopCleanupPromise !== undefined) return;
    stopCleanupGeneration = generation;
    const operation = serializedCleanup(async () => finishStop(generation)).catch(() => undefined);
    stopCleanupPromise = operation;
    void operation.then(() => {
      if (stopCleanupPromise === operation) {
        stopCleanupPromise = undefined;
        stopCleanupGeneration = undefined;
      }
    });
  };

  const beginStop = (): void => {
    if (phase === 'idle' || phase === 'checkpointed') return;
    const generation = sessionGeneration;
    if (!generation) return unavailable();
    if (phase !== 'stopping') {
      phase = 'stopping';
      frameImage = undefined;
      frameCapturedAtMs = undefined;
      cancelExpiry();
    }
    queueStopCleanup(generation);
  };

  const queueFaultCleanup = (generation: string): void => {
    if (faultCleanupGeneration === generation) return;
    faultCleanupGeneration = generation;
    void serialized(async () => {
      if (faultCleanupGeneration === generation) faultCleanupGeneration = undefined;
      if (sessionGeneration === generation && phase === 'faulted') beginStop();
    }).catch(() => undefined);
  };

  const markFaulted = (generation: string): void => {
    if (
      sessionGeneration !== generation ||
      phase === 'idle' ||
      phase === 'checkpointed' ||
      phase === 'stopping'
    ) {
      return;
    }
    phase = 'faulted';
    frameImage = undefined;
    frameCapturedAtMs = undefined;
    // Preserve the already-armed immutable deadline. Cleanup is attempted immediately, and a
    // failed clean close remains bounded by that original deadline rather than extending it.
    queueFaultCleanup(generation);
  };

  const acceptAuthenticatedIdentityProof = (
    generation: string,
    observedContext: BrowserContext,
    observedPage: Page,
    verificationEpoch: number,
  ): void => {
    if (
      generation !== sessionGeneration ||
      context !== observedContext ||
      page !== observedPage ||
      verificationEpoch !== identityVerificationEpoch ||
      validPageUrl(observedPage.url()) !== 'agents' ||
      phase === 'stopping' ||
      phase === 'faulted' ||
      checkpointedForRecheck
    ) {
      return;
    }
    const timestamp = now().getTime();
    const monotonicTimestamp = readMonotonicNow();
    if (
      !expiresAt ||
      expiresAtMonotonicMs === undefined ||
      !generationDeadline ||
      generationDeadlineMonotonicMs === undefined ||
      timestamp >= expiresAt.getTime() ||
      monotonicTimestamp >= expiresAtMonotonicMs ||
      timestamp >= generationDeadline.getTime() ||
      monotonicTimestamp >= generationDeadlineMonotonicMs
    ) {
      beginStop();
      return;
    }
    // This is the sole transition that accepts authentication. A candidate URL by itself never
    // sets signedIn; the exact immutable authorization has already been re-observed through the
    // UUID-bound fingerprinter in the reviewed selector contract before this deadline check.
    phase = 'authenticated';
    frameImage = undefined;
    frameCapturedAtMs = undefined;
    authenticatedDeadline ??= new Date(
      Math.min(timestamp + AUTHENTICATED_SESSION_LIFETIME_MS, generationDeadline.getTime()),
    );
    authenticatedDeadlineMonotonicMs ??= Math.min(
      monotonicTimestamp + AUTHENTICATED_SESSION_LIFETIME_MS,
      generationDeadlineMonotonicMs,
    );
    armExpiryAt(authenticatedDeadline, authenticatedDeadlineMonotonicMs, generation);
    if (!signedInLogged) {
      signedInLogged = true;
      log('signed_in');
    }
  };

  const beginAuthenticatedIdentityVerification = (
    generation: string,
    observedContext: BrowserContext,
    observedPage: Page,
  ): void => {
    if (
      identityVerificationPromise !== undefined ||
      !authenticatedIdentityVerifier ||
      authenticatedIdentityVerifier.accountId !== accountId
    ) {
      if (!authenticatedIdentityVerifier) markFaulted(generation);
      return;
    }
    phase = 'authenticating';
    frameImage = undefined;
    frameCapturedAtMs = undefined;
    const verificationEpoch = ++identityVerificationEpoch;
    let task: Promise<void>;
    try {
      task = authenticatedIdentityVerifier.verify(observedPage);
    } catch {
      markFaulted(generation);
      return;
    }
    identityVerificationPromise = task;
    void task
      .then(
        () =>
          serialized(async () => {
            acceptAuthenticatedIdentityProof(
              generation,
              observedContext,
              observedPage,
              verificationEpoch,
            );
          }),
        () =>
          serialized(async () => {
            if (
              generation === sessionGeneration &&
              context === observedContext &&
              page === observedPage &&
              verificationEpoch === identityVerificationEpoch &&
              validPageUrl(observedPage.url()) === 'agents'
            ) {
              markFaulted(generation);
            }
          }),
      )
      .catch(() => undefined)
      .finally(() => {
        if (identityVerificationPromise !== task) return;
        identityVerificationPromise = undefined;
        // A stale proof may finish after the page briefly returned to login and then reached the
        // candidate route again. Re-run the exact immutable identity check for the current epoch;
        // never let a stale in-flight promise strand a live candidate without proof.
        void serialized(async () => {
          if (
            sessionGeneration === generation &&
            (context === observedContext || pendingContext === observedContext) &&
            (page === observedPage || pendingPage === observedPage) &&
            phase !== 'authenticated' &&
            phase !== 'stopping' &&
            phase !== 'faulted' &&
            !checkpointedForRecheck &&
            validPageUrl(observedPage.url()) === 'agents'
          ) {
            beginAuthenticatedIdentityVerification(generation, observedContext, observedPage);
          }
        }).catch(() => undefined);
      });
  };

  const updatePagePhase = (
    generation: string,
    observedContext: BrowserContext,
    observedPage: Page,
  ): 'agents' | 'login' | undefined => {
    if (
      generation !== sessionGeneration ||
      context !== observedContext ||
      page !== observedPage ||
      phase === 'stopping' ||
      phase === 'faulted' ||
      checkpointedForRecheck
    ) {
      return undefined;
    }
    const state = validPageUrl(observedPage.url());
    if (!state) {
      markFaulted(generation);
      return undefined;
    }
    if (state === 'agents' && phase !== 'authenticated') {
      beginAuthenticatedIdentityVerification(generation, observedContext, observedPage);
    } else if (state === 'login' && phase !== 'login_required') {
      identityVerificationEpoch += 1;
      phase = 'login_required';
      const currentDeadline = expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const currentMonotonicDeadline = expiresAtMonotonicMs ?? Number.POSITIVE_INFINITY;
      const loginDeadline = new Date(
        Math.min(now().getTime() + LOGIN_LIFETIME_MS, currentDeadline),
      );
      const loginDeadlineMonotonicMs = Math.min(
        readMonotonicNow() + LOGIN_LIFETIME_MS,
        currentMonotonicDeadline,
      );
      armExpiryAt(
        authenticatedDeadline && authenticatedDeadline.getTime() < loginDeadline.getTime()
          ? authenticatedDeadline
          : loginDeadline,
        authenticatedDeadlineMonotonicMs !== undefined &&
          authenticatedDeadlineMonotonicMs < loginDeadlineMonotonicMs
          ? authenticatedDeadlineMonotonicMs
          : loginDeadlineMonotonicMs,
        generation,
      );
    }
    return state;
  };

  const captureLoginFrame = async (generation: string, observedPage: Page): Promise<void> => {
    if (
      generation !== sessionGeneration ||
      page !== observedPage ||
      phase !== 'login_required' ||
      validPageUrl(observedPage.url()) !== 'login'
    ) {
      return;
    }
    const image = await observedPage.screenshot({
      animations: 'disabled',
      quality: 70,
      timeout: FRAME_CAPTURE_TIMEOUT_MS,
      type: 'jpeg',
    });
    if (
      generation === sessionGeneration &&
      page === observedPage &&
      phase === 'login_required' &&
      validPageUrl(observedPage.url()) === 'login'
    ) {
      frameImage = image;
      frameCapturedAtMs = now().getTime();
      frameSequence += 1;
    }
  };

  const status = async (expectedAccountId?: string): Promise<KemerBetProvisionSessionStatus> => {
    // Once a checkpoint/seal request installs the irreversible terminal latch, a failed
    // Chromium close must not make the still-live context look usable again.
    const exactTerminalStartupFailure =
      expectedAccountId !== undefined &&
      phase === 'idle' &&
      startupStatus?.status === 'failed' &&
      terminalStartupAccountId === expectedAccountId;
    if (
      checkpointedForRecheck &&
      phase !== 'checkpointed' &&
      quarantineReasonCode === undefined &&
      !exactTerminalStartupFailure
    ) {
      return unavailable();
    }
    if (
      expectedAccountId !== undefined &&
      phase === 'idle' &&
      !checkpointedForRecheck &&
      quarantineReasonCode === undefined
    ) {
      const inspection = await inspectRequestedProfileGenerationStatus(
        expectedAccountId,
        effectiveUserId,
      );
      if (inspection.state === 'quarantined') {
        checkpointedForRecheck = true;
        quarantinedAccountId = expectedAccountId;
        quarantineReasonCode = inspection.reasonCode;
        log('profile_quarantined');
      }
    }
    if (
      expiresAt &&
      expiresAtMonotonicMs !== undefined &&
      (now().getTime() >= expiresAt.getTime() || readMonotonicNow() >= expiresAtMonotonicMs)
    ) {
      beginStop();
    }
    return snapshot();
  };

  const initialize = async (input: StartInput, generation: string): Promise<void> => {
    let nextContext: BrowserContext | undefined;
    let nextPage: Page | undefined;
    let profile: string | undefined;
    let generationLease: KemerBetSessionProfileGenerationLease | undefined;
    let identityVerifier: KemerBetProvisionAuthenticatedIdentityVerifier | undefined;
    let startupStage: KemerBetProvisionStartupStage = 'preflight';
    reportStartupStage(generation, startupStage);
    try {
      const [, preparedIdentityVerifier] = await Promise.all([
        (
          dependencies.assertBrowserExecutable ??
          (() => assertKemerBetBrowserExecutable({ executablePath: CHROMIUM_PATH }))
        )(),
        prepareAuthenticatedIdentityVerifier(input.platformAgentAccountId, effectiveUserId),
      ]);
      identityVerifier = preparedIdentityVerifier;
      if (identityVerifier.accountId !== input.platformAgentAccountId) {
        recordStartupFailure(generation, startupStage, 'contract_mismatch');
        return unavailable();
      }
      startupStage = 'profile';
      reportStartupStage(generation, startupStage);
      profile = await (dependencies.prepareSessionProfile ?? prepareProfile)(
        input.platformAgentAccountId,
        effectiveUserId,
      );
      await validateSessionProfile(profile, effectiveUserId);
      const profileLeaseInspection = await inspectProfileGenerationLease(profile, effectiveUserId);
      if (profileLeaseInspection.state === 'quarantined') {
        installInactiveQuarantine(
          generation,
          input.platformAgentAccountId,
          profileLeaseInspection.reasonCode,
        );
        return;
      }
      // Install the durable crash marker before mutating any reusable profile state. A marker
      // left by another process blocks this exact immutable revision before singleton cleanup.
      generationLease = await acquireProfileGenerationLease(profile, effectiveUserId);
      pendingProfilePath = profile;
      pendingProfileGenerationLease = generationLease;
      await removeStaleChromiumSingletonArtifacts(profile);
      // A persistent worker can bypass Playwright HTTP routing. Remove only Chromium's exact
      // service-worker subtree while the profile is offline and before any browser process exists.
      await purgePersistedServiceWorkerState(profile, effectiveUserId);
      startupStage = 'browser_launch';
      reportStartupStage(generation, startupStage);
      nextContext = await launch(profile, {
        acceptDownloads: false,
        args: [...KEMERBET_CHROMIUM_NETWORK_REDUCTION_ARGUMENTS],
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
        // Remove only Playwright 1.62.1's exact combined feature switch and replace it above with
        // one strict superset. Every other Playwright default argument remains intact.
        ignoreDefaultArgs: [PLAYWRIGHT_1_62_1_DISABLED_CHROMIUM_FEATURES_ARGUMENT],
        ignoreHTTPSErrors: false,
        offline: true,
        serviceWorkers: 'block',
        timeout: 30_000,
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
      pendingContext = nextContext;
      pendingPage = nextPage;
      const observedContext = nextContext;
      const observedPage = nextPage;
      startupStage = 'transport_guard';
      reportStartupStage(generation, startupStage);
      let startupBoundaryViolated = false;
      const observeForbiddenNetworkAttempt = (
        failureStage: KemerBetProvisionStartupStage,
      ): void => {
        startupBoundaryViolated = true;
        recordStartupFailure(generation, failureStage, 'forbidden_request');
        blockedRequestCounter += 1n;
        if (checkpointValidationActive) checkpointBlockedForRecheck = true;
        void serialized(async () => {
          if (
            sessionGeneration === generation &&
            (context === observedContext || pendingContext === observedContext) &&
            phase !== 'stopping' &&
            !checkpointedForRecheck
          ) {
            markFaulted(generation);
          }
        });
      };
      const beforeActiveSessionDeadline = (): boolean => {
        const wallTimestamp = now().getTime();
        const monotonicTimestamp = readMonotonicNow();
        return (
          sessionGeneration === generation &&
          phase !== 'stopping' &&
          phase !== 'faulted' &&
          !checkpointedForRecheck &&
          Number.isFinite(wallTimestamp) &&
          expiresAt !== undefined &&
          expiresAtMonotonicMs !== undefined &&
          generationDeadline !== undefined &&
          generationDeadlineMonotonicMs !== undefined &&
          wallTimestamp < expiresAt.getTime() &&
          monotonicTimestamp < expiresAtMonotonicMs &&
          wallTimestamp < generationDeadline.getTime() &&
          monotonicTimestamp < generationDeadlineMonotonicMs &&
          (authenticatedDeadline === undefined ||
            wallTimestamp < authenticatedDeadline.getTime()) &&
          (authenticatedDeadlineMonotonicMs === undefined ||
            monotonicTimestamp < authenticatedDeadlineMonotonicMs)
        );
      };
      const observeActiveSessionDeadlineExceeded = (): void => {
        recordStartupFailure(generation, startupStage, 'deadline_exceeded');
        void serialized(async () => {
          if (
            sessionGeneration === generation &&
            (context === observedContext || pendingContext === observedContext) &&
            phase !== 'stopping' &&
            !checkpointedForRecheck
          ) {
            beginStop();
          }
        });
      };
      if (expiresAt === undefined || expiresAtMonotonicMs === undefined) return unavailable();
      const newRecaptchaCeremony = (
        deadlineWallClockMs: number,
        deadlineMonotonicMs: number,
      ): KemerBetRecaptchaCeremony =>
        buildRecaptchaCeremony({
          deadlineMonotonicMs,
          deadlineWallClockMs,
          fetchAsset: fetchRecaptchaAsset,
          monotonicNow: readMonotonicNow,
          onForbiddenRequest: (stage) => observeForbiddenNetworkAttempt(stage),
          onStage: (stage) => {
            // Request progress is useful to the Owner, but it is concurrent with the enclosing
            // startup operation. Do not let an asset callback rewrite the operation-local stage
            // used if the enclosing navigation itself later fails or crosses its deadline.
            reportStartupStage(generation, stage);
          },
          wallClockNow: () => now().getTime(),
        });
      let recaptchaCeremony = newRecaptchaCeremony(expiresAt.getTime(), expiresAtMonotonicMs);
      observedContext.on('page', (candidatePage) => {
        if (candidatePage === observedPage) return;
        observeForbiddenNetworkAttempt('transport_guard');
        void candidatePage.close().catch(() => undefined);
      });
      observedContext.on('serviceworker', () => {
        observeForbiddenNetworkAttempt('transport_guard');
      });
      await observedContext.route('**/*', (route) =>
        guardedRoute(
          route,
          observedPage,
          recaptchaCeremony,
          beforeActiveSessionDeadline,
          observeActiveSessionDeadlineExceeded,
          observeForbiddenNetworkAttempt,
          (stage) => {
            // Provider subresources may race one another while the fixed startup navigation is
            // still in flight. Keep their progress visible without changing the causal fallback
            // stage for a failure of that navigation operation.
            reportStartupStage(generation, stage);
          },
        ),
      );
      await observedContext.routeWebSocket('**/*', async (webSocket: WebSocketRoute) => {
        try {
          await closeKemerBetReadinessGuardedWebSocket({
            lifecycleBoundary: {
              observeWebSocket: () => observeForbiddenNetworkAttempt('transport_guard'),
            },
            reportUnexpected: () => undefined,
            webSocket,
          });
        } catch {
          // Failing to close even an exact optional notification socket leaves its transport
          // state uncertain, so poison the whole immutable generation.
          observeForbiddenNetworkAttempt('transport_guard');
        }
      });
      nextPage.on('framenavigated', (frame) => {
        if (frame === observedPage.mainFrame()) {
          if (
            sessionGeneration === generation &&
            (context === observedContext || pendingContext === observedContext) &&
            (page === observedPage || pendingPage === observedPage) &&
            phase !== 'stopping' &&
            phase !== 'faulted' &&
            !checkpointedForRecheck
          ) {
            const committedState = validPageUrl(observedPage.url());
            const returningToLogin = committedState === 'login' && phase === 'authenticated';
            if (returningToLogin) {
              // A provider-side session expiry may return an otherwise retained authenticated
              // browser to login. Swap the one-document ceremony synchronously at the commit,
              // before subresources can enter the route handler. Its deadline may only shorten
              // the immutable authenticated/generation lease; it never starts another 12 hours.
              let replacement: KemerBetRecaptchaCeremony | undefined;
              try {
                const wallTimestamp = now().getTime();
                const monotonicTimestamp = readMonotonicNow();
                if (
                  !Number.isFinite(wallTimestamp) ||
                  expiresAt === undefined ||
                  expiresAtMonotonicMs === undefined ||
                  authenticatedDeadline === undefined ||
                  authenticatedDeadlineMonotonicMs === undefined ||
                  generationDeadline === undefined ||
                  generationDeadlineMonotonicMs === undefined
                ) {
                  throw new Error('missing immutable reauthentication deadline');
                }
                if (
                  wallTimestamp >= expiresAt.getTime() ||
                  wallTimestamp >= authenticatedDeadline.getTime() ||
                  wallTimestamp >= generationDeadline.getTime() ||
                  monotonicTimestamp >= expiresAtMonotonicMs ||
                  monotonicTimestamp >= authenticatedDeadlineMonotonicMs ||
                  monotonicTimestamp >= generationDeadlineMonotonicMs
                ) {
                  throw new Error('expired immutable reauthentication deadline');
                }
                const reauthenticationDeadlineWallClockMs = Math.min(
                  wallTimestamp + LOGIN_LIFETIME_MS,
                  expiresAt.getTime(),
                  authenticatedDeadline.getTime(),
                  generationDeadline.getTime(),
                );
                const reauthenticationDeadlineMonotonicMs = Math.min(
                  monotonicTimestamp + LOGIN_LIFETIME_MS,
                  expiresAtMonotonicMs,
                  authenticatedDeadlineMonotonicMs,
                  generationDeadlineMonotonicMs,
                );
                replacement = newRecaptchaCeremony(
                  reauthenticationDeadlineWallClockMs,
                  reauthenticationDeadlineMonotonicMs,
                );
              } catch {
                observeForbiddenNetworkAttempt('transport_guard');
              }
              if (replacement !== undefined) {
                if (recaptchaCeremony.retireForReauthentication()) {
                  recaptchaCeremony = replacement;
                }
              }
            } else {
              // The one-use reCAPTCHA proof belongs to exactly one committed login document. A
              // same-URL reload is still a different document and therefore poisons an in-flight
              // ceremony; the sole post-ceremony transition is the expected /agents commit.
              recaptchaCeremony.observeMainFrameCommit(observedPage.url());
            }
            // An identity proof (including one still in flight) is bound to one committed
            // main-frame document. Revoke its epoch synchronously at every commit, even when both
            // old and new documents use /agents, so document A can never authenticate document B.
            identityVerificationEpoch += 1;
            if (phase === 'authenticated') phase = 'authenticating';
            frameImage = undefined;
            frameCapturedAtMs = undefined;
          }
          void serialized(async () => {
            updatePagePhase(generation, observedContext, observedPage);
          });
        }
      });
      nextPage.on('crash', () => {
        void serialized(async () => {
          if (
            sessionGeneration === generation &&
            (context === observedContext || pendingContext === observedContext) &&
            (page === observedPage || pendingPage === observedPage) &&
            phase !== 'stopping'
          ) {
            markFaulted(generation);
          }
        });
      });
      nextPage.on('close', () => {
        void serialized(async () => {
          if (
            sessionGeneration === generation &&
            (context === observedContext || pendingContext === observedContext) &&
            (page === observedPage || pendingPage === observedPage) &&
            phase !== 'stopping' &&
            !checkpointedForRecheck &&
            !expectedContextClosures.has(observedContext)
          ) {
            markFaulted(generation);
          }
        });
      });
      nextContext.on('close', () => {
        if (
          sessionGeneration === generation &&
          (context === observedContext || pendingContext === observedContext) &&
          phase !== 'stopping' &&
          !checkpointedForRecheck &&
          !expectedContextClosures.has(observedContext)
        ) {
          // An unexpected process/context close is not a restorable profile checkpoint. Keep the
          // profile permanently unavailable in this process even after cleanup bookkeeping ends.
          contextUnexpectedlyClosed = true;
          checkpointedForRecheck = true;
          identityVerificationEpoch += 1;
          frameImage = undefined;
          frameCapturedAtMs = undefined;
        }
        void serialized(async () => {
          if (
            sessionGeneration === generation &&
            (context === observedContext || pendingContext === observedContext) &&
            phase !== 'stopping' &&
            !expectedContextClosures.has(observedContext)
          ) {
            markFaulted(generation);
          }
        });
      });
      // The persistent context starts offline. Only after context-wide HTTP, WebSocket, popup,
      // crash, and close latches are installed may the exact reviewed login transport go online.
      const guardedPages = observedContext.pages();
      if (
        guardedPages.length !== 1 ||
        guardedPages[0] !== observedPage ||
        observedContext.serviceWorkers().length !== 0 ||
        startupBoundaryViolated
      ) {
        recordStartupFailure(generation, startupStage, 'contract_mismatch');
        return unavailable();
      }
      startupStage = 'provider_navigation';
      reportStartupStage(generation, startupStage);
      await observedContext.setOffline(false);
      await nextPage.goto(KEMERBET_AGENT_LOGIN_RETRY_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      if (
        validPageUrl(nextPage.url()) === undefined ||
        startupBoundaryViolated ||
        startupFailureCandidate !== undefined
      ) {
        recordStartupFailure(generation, startupStage, 'contract_mismatch');
        return unavailable();
      }
      reportStartupReady(generation);
    } catch (error) {
      if (error instanceof KemerBetSessionProfileGenerationQuarantinedError) {
        installInactiveQuarantine(generation, input.platformAgentAccountId, error.reasonCode);
        return;
      }
      recordStartupFailure(generation, startupStage, 'dependency_unavailable');
      let closed = true;
      let forcedContextClose = false;
      try {
        const contextAlreadyClosed = contextUnexpectedlyClosed;
        if (nextContext && nextPage?.isClosed() === true && !contextAlreadyClosed) {
          await nextContext.close();
          forcedContextClose = true;
        } else if (nextContext && nextPage && profile && !contextAlreadyClosed) {
          await closeBrowserCleanly(nextContext, nextPage, profile);
          if (!generationLease) return unavailable();
          await generationLease.releaseAfterCleanCheckpoint();
        } else if (nextContext && !contextAlreadyClosed) {
          await nextContext.close();
          forcedContextClose = true;
        } else if (generationLease) {
          forcedContextClose = true;
        }
      } catch {
        closed = false;
      }
      if (sessionGeneration === generation) {
        if (closed && !forcedContextClose && phase !== 'starting') {
          // A transport callback can move the session to faulted/stopping while this initializer
          // is still unwinding. When this branch has already produced and released an exact clean
          // checkpoint, publish the original causal failure and retire the in-memory generation
          // here. Reattaching the now-closed context/lease would make finishStop close it a second
          // time and falsely convert the result into cleanup_unverified plus a permanent latch.
          publishStartupFailure(generation);
          clearRuntimeState('idle', true);
        } else if (closed && phase === 'starting') {
          if (forcedContextClose) checkpointedForRecheck = true;
          if (forcedContextClose) {
            publishStartupFailure(generation, {
              failureCode: 'cleanup_unverified',
              stage: 'cleanup',
            });
          } else {
            publishStartupFailure(generation);
          }
          clearRuntimeState('idle', true);
        } else {
          if (!closed) {
            publishStartupFailure(generation, {
              failureCode: 'cleanup_unverified',
              stage: 'cleanup',
            });
          }
          context = nextContext;
          page = nextPage;
          profilePath = profile;
          profileGenerationLease = generationLease;
          authenticatedIdentityVerifier = identityVerifier;
          markFaulted(generation);
        }
      }
      return;
    }
    if (!nextContext || !nextPage || !profile) return;
    if (sessionGeneration !== generation || phase !== 'starting') {
      try {
        await closeBrowserCleanly(nextContext, nextPage, profile);
        if (!generationLease) return unavailable();
        await generationLease.releaseAfterCleanCheckpoint();
        pendingContext = undefined;
        pendingPage = undefined;
        pendingProfilePath = undefined;
        pendingProfileGenerationLease = undefined;
      } catch {
        if (sessionGeneration === generation) {
          context = nextContext;
          page = nextPage;
          profilePath = profile;
          profileGenerationLease = generationLease;
          authenticatedIdentityVerifier = identityVerifier;
          markFaulted(generation);
        }
      }
      return;
    }
    context = nextContext;
    page = nextPage;
    profilePath = profile;
    profileGenerationLease = generationLease;
    authenticatedIdentityVerifier = identityVerifier;
    pendingContext = undefined;
    pendingPage = undefined;
    pendingProfilePath = undefined;
    pendingProfileGenerationLease = undefined;
    checkpointBlockedForRecheck = false;
    const currentState = updatePagePhase(generation, nextContext, nextPage);
    log('started');
    if (currentState === 'login') {
      // Keep every screenshot in the same serialized lane as input. This prevents an eager
      // startup capture from committing an older image after a newer input-bound frame.
      void serialized(async () => {
        try {
          if (frameImage === undefined) await captureLoginFrame(generation, nextPage as Page);
        } catch {
          // A missing preview frame is recoverable; the next bounded frame poll retries it.
        }
      });
    }
  };

  const start = (input: StartInput): KemerBetProvisionSessionStatus => {
    if (
      phase === 'idle' &&
      startupStatus?.status === 'failed' &&
      terminalStartupRequestId === input.requestId
    ) {
      if (terminalStartupAccountId === input.platformAgentAccountId) return snapshot();
      return unavailable();
    }
    if (checkpointedForRecheck) {
      if (
        quarantineReasonCode !== undefined &&
        quarantinedAccountId === input.platformAgentAccountId
      ) {
        return snapshot();
      }
      return unavailable();
    }
    if (sessionGeneration !== undefined) {
      if (sessionGeneration === input.requestId && accountId === input.platformAgentAccountId) {
        return snapshot();
      }
      return unavailable();
    }
    if (
      phase !== 'idle' ||
      context ||
      page ||
      profilePath ||
      profileGenerationLease ||
      pendingProfileGenerationLease ||
      accountId ||
      expiresAt
    ) {
      return unavailable();
    }
    startupStatus = createKemerBetProvisionStartupStatus('starting', 'preflight');
    startupFailureCandidate = undefined;
    startupFailureLogged = false;
    terminalStartupAccountId = undefined;
    terminalStartupRequestId = undefined;
    phase = 'starting';
    sessionGeneration = input.requestId;
    accountId = input.platformAgentAccountId;
    generationDeadline = new Date(now().getTime() + MAX_GENERATION_LIFETIME_MS);
    generationDeadlineMonotonicMs = readMonotonicNow() + MAX_GENERATION_LIFETIME_MS;
    frameSequence = 0;
    frameImage = undefined;
    frameCapturedAtMs = undefined;
    armHardDeadline(input.requestId);
    armExpiry(LOGIN_LIFETIME_MS, input.requestId);
    const task = initialize(input, input.requestId);
    initializationPromise = task;
    void task.finally(() => {
      if (initializationPromise === task) initializationPromise = undefined;
    });
    return snapshot();
  };

  const checkpointForRecheck = async (): Promise<KemerBetProvisionCheckpointResult> => {
    const currentStatus = await status();
    if (
      checkpointedForRecheck ||
      checkpointBlockedForRecheck ||
      !currentStatus.signedIn ||
      !context ||
      !page ||
      !profilePath ||
      !profileGenerationLease ||
      !authenticatedIdentityVerifier ||
      !accountId ||
      !expiresAt ||
      expiresAtMonotonicMs === undefined ||
      !generationDeadline ||
      generationDeadlineMonotonicMs === undefined ||
      !signedInLogged ||
      now().getTime() >= expiresAt.getTime() ||
      readMonotonicNow() >= expiresAtMonotonicMs ||
      now().getTime() >= generationDeadline.getTime() ||
      readMonotonicNow() >= generationDeadlineMonotonicMs ||
      validPageUrl(page.url()) !== 'agents'
    ) {
      return unavailable();
    }
    const retainedContext = context;
    const retainedPage = page;
    const retainedProfilePath = profilePath;
    const retainedProfileGenerationLease = profileGenerationLease;
    const retainedAuthenticatedIdentityVerifier = authenticatedIdentityVerifier;
    const retainedAccountId = accountId;
    const retainedExpiresAt = expiresAt;
    const retainedExpiresAtMonotonicMs = expiresAtMonotonicMs;
    const retainedGenerationDeadline = generationDeadline;
    const retainedGenerationDeadlineMonotonicMs = generationDeadlineMonotonicMs;
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
        profilePath !== retainedProfilePath ||
        profileGenerationLease !== retainedProfileGenerationLease ||
        authenticatedIdentityVerifier !== retainedAuthenticatedIdentityVerifier ||
        accountId !== retainedAccountId ||
        expiresAt !== retainedExpiresAt ||
        expiresAtMonotonicMs !== retainedExpiresAtMonotonicMs ||
        generationDeadline !== retainedGenerationDeadline ||
        generationDeadlineMonotonicMs !== retainedGenerationDeadlineMonotonicMs ||
        blockedRequestCounter !== blockedRequestBaseline ||
        checkpointBlockedForRecheck ||
        validPageUrl(retainedPage.url()) !== 'agents' ||
        now().getTime() >= retainedExpiresAt.getTime() ||
        readMonotonicNow() >= retainedExpiresAtMonotonicMs ||
        now().getTime() >= retainedGenerationDeadline.getTime() ||
        readMonotonicNow() >= retainedGenerationDeadlineMonotonicMs
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
      await closePersistentBrowserForCheckpoint(
        {
          context: retainedContext,
          effectiveUserId,
          page: retainedPage,
          profilePath: retainedProfilePath,
        },
        { clearTimer, setTimer },
      );
      await retainedProfileGenerationLease.releaseAfterCleanCheckpoint();
      if (
        context !== retainedContext ||
        page !== retainedPage ||
        profilePath !== retainedProfilePath ||
        profileGenerationLease !== retainedProfileGenerationLease ||
        accountId !== retainedAccountId ||
        expiresAt !== retainedExpiresAt ||
        expiresAtMonotonicMs !== retainedExpiresAtMonotonicMs ||
        generationDeadline !== retainedGenerationDeadline ||
        generationDeadlineMonotonicMs !== retainedGenerationDeadlineMonotonicMs ||
        blockedRequestCounter !== blockedRequestBaseline ||
        checkpointBlockedForRecheck ||
        now().getTime() >= retainedExpiresAt.getTime() ||
        readMonotonicNow() >= retainedExpiresAtMonotonicMs ||
        now().getTime() >= retainedGenerationDeadline.getTime() ||
        readMonotonicNow() >= retainedGenerationDeadlineMonotonicMs
      ) {
        return unavailable();
      }
      clearRuntimeState('checkpointed');
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
    const requireUnexpiredInputLease = (): void => {
      const timestamp = now().getTime();
      const monotonicTimestamp = readMonotonicNow();
      if (
        !expiresAt ||
        expiresAtMonotonicMs === undefined ||
        !generationDeadline ||
        generationDeadlineMonotonicMs === undefined ||
        timestamp >= expiresAt.getTime() ||
        monotonicTimestamp >= expiresAtMonotonicMs ||
        timestamp >= generationDeadline.getTime() ||
        monotonicTimestamp >= generationDeadlineMonotonicMs
      ) {
        if (sessionGeneration !== undefined) beginStop();
        return unavailable();
      }
    };
    requireUnexpiredInputLease();
    if (
      checkpointedForRecheck ||
      phase !== 'login_required' ||
      candidate.platformAgentAccountId !== accountId ||
      candidate.sessionGeneration !== sessionGeneration ||
      candidate.frameSequence !== frameSequence ||
      frameImage === undefined ||
      !context ||
      !page ||
      !profilePath ||
      !profileGenerationLease ||
      !authenticatedIdentityVerifier ||
      !accountId ||
      !expiresAt ||
      validPageUrl(page.url()) !== 'login'
    ) {
      return unavailable();
    }
    const retainedGeneration = sessionGeneration;
    const retainedContext = context;
    const retainedPage = page;
    // Consume the displayed frame before dispatching input. If Playwright reports an error after
    // partially dispatching an event, the same frame can never be replayed.
    frameImage = undefined;
    frameCapturedAtMs = undefined;
    // Re-read the non-sliding lease immediately before the only browser-input dispatch. A clock
    // reaching the exact deadline between validation and dispatch rejects and closes the session.
    requireUnexpiredInputLease();
    if (candidate.kind === 'pointer') {
      await retainedPage.mouse.click(candidate.x, candidate.y);
    } else if (candidate.kind === 'key' && NAMED_KEYS.has(candidate.key)) {
      await retainedPage.keyboard.press(candidate.key);
    } else if (candidate.kind === 'key') {
      await retainedPage.keyboard.insertText(candidate.key);
    } else {
      await retainedPage.keyboard.insertText(candidate.text);
    }
    await retainedPage.waitForTimeout(120);
    updatePagePhase(retainedGeneration, retainedContext, retainedPage);
    if (phase === 'login_required') await captureLoginFrame(retainedGeneration, retainedPage);
    return snapshot();
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
      checkpointedForRecheck ||
      !currentStatus.signedIn ||
      !signedInLogged ||
      !context ||
      !page ||
      !profilePath ||
      !profileGenerationLease ||
      !authenticatedIdentityVerifier ||
      !accountId ||
      !expiresAt ||
      expiresAtMonotonicMs === undefined ||
      !generationDeadline ||
      generationDeadlineMonotonicMs === undefined ||
      now().getTime() >= expiresAt.getTime() ||
      readMonotonicNow() >= expiresAtMonotonicMs ||
      now().getTime() >= generationDeadline.getTime() ||
      readMonotonicNow() >= generationDeadlineMonotonicMs ||
      validPageUrl(page.url()) !== 'agents'
    ) {
      return unavailable();
    }
    const retainedContext = context;
    const retainedPage = page;
    const retainedProfilePath = profilePath;
    const retainedProfileGenerationLease = profileGenerationLease;
    const retainedAuthenticatedIdentityVerifier = authenticatedIdentityVerifier;
    const retainedAccountId = accountId;
    const retainedExpiresAt = expiresAt;
    const retainedExpiresAtMonotonicMs = expiresAtMonotonicMs;
    const retainedGenerationDeadline = generationDeadline;
    const retainedGenerationDeadlineMonotonicMs = generationDeadlineMonotonicMs;
    const requireRetainedLeaseUnexpired = (): void => {
      if (
        now().getTime() >= retainedExpiresAt.getTime() ||
        readMonotonicNow() >= retainedExpiresAtMonotonicMs ||
        now().getTime() >= retainedGenerationDeadline.getTime() ||
        readMonotonicNow() >= retainedGenerationDeadlineMonotonicMs
      ) {
        return unavailable();
      }
    };
    let retainedContextClosed = false;
    // This private manual sign-in/seal lane is an explicitly trusted supervised enrollment
    // ceremony, not a compromised-renderer confidentiality boundary: Chromium and trusted Node
    // share UID 10001 while seal-only inputs are mounted. Containment begins only after this exact
    // context is terminally closed and the retained enrollment state below is cleared.
    const closeRetainedContextForSeal = async (): Promise<void> => {
      if (retainedContextClosed) return;
      if (checkpointedForRecheck) return unavailable();
      if (
        context !== retainedContext ||
        page !== retainedPage ||
        profilePath !== retainedProfilePath ||
        profileGenerationLease !== retainedProfileGenerationLease ||
        authenticatedIdentityVerifier !== retainedAuthenticatedIdentityVerifier ||
        accountId !== retainedAccountId ||
        expiresAt !== retainedExpiresAt ||
        expiresAtMonotonicMs !== retainedExpiresAtMonotonicMs ||
        generationDeadline !== retainedGenerationDeadline ||
        generationDeadlineMonotonicMs !== retainedGenerationDeadlineMonotonicMs
      ) {
        return unavailable();
      }
      requireRetainedLeaseUnexpired();
      // Keep the terminal request latch installed through the awaited Chromium shutdown. Only a
      // confirmed close may make the same-UID provision lane inactive before the seal file is
      // installed; a close failure propagates and therefore emits no binding.
      checkpointedForRecheck = true;
      await closePersistentBrowserForCheckpoint(
        {
          context: retainedContext,
          effectiveUserId,
          page: retainedPage,
          profilePath: retainedProfilePath,
        },
        { clearTimer, setTimer },
      );
      await retainedProfileGenerationLease.releaseAfterCleanCheckpoint();
      if (
        context !== retainedContext ||
        page !== retainedPage ||
        profilePath !== retainedProfilePath ||
        profileGenerationLease !== retainedProfileGenerationLease ||
        authenticatedIdentityVerifier !== retainedAuthenticatedIdentityVerifier ||
        accountId !== retainedAccountId ||
        expiresAt !== retainedExpiresAt ||
        expiresAtMonotonicMs !== retainedExpiresAtMonotonicMs ||
        generationDeadline !== retainedGenerationDeadline ||
        generationDeadlineMonotonicMs !== retainedGenerationDeadlineMonotonicMs
      ) {
        return unavailable();
      }
      requireRetainedLeaseUnexpired();
      clearRuntimeState('checkpointed');
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
      createAgentIdentityFingerprinter: async () =>
        retainedAuthenticatedIdentityVerifier.fingerprintAgentIdentity,
      loadPlayerIds: loadReadinessPlayerIds,
      reportStage: readinessFailure.reportStage,
      reportForbiddenRequest: readinessFailure.reportForbiddenRequest,
      openProbe: async (options) => {
        if (
          options.accountId !== retainedAccountId ||
          context !== retainedContext ||
          page !== retainedPage ||
          profilePath !== retainedProfilePath ||
          profileGenerationLease !== retainedProfileGenerationLease ||
          authenticatedIdentityVerifier !== retainedAuthenticatedIdentityVerifier ||
          accountId !== retainedAccountId ||
          expiresAt !== retainedExpiresAt ||
          expiresAtMonotonicMs !== retainedExpiresAtMonotonicMs ||
          generationDeadline !== retainedGenerationDeadline ||
          generationDeadlineMonotonicMs !== retainedGenerationDeadlineMonotonicMs ||
          validPageUrl(retainedPage.url()) !== 'agents'
        ) {
          return unavailable();
        }
        requireRetainedLeaseUnexpired();
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
      profilePath !== undefined ||
      accountId !== undefined ||
      expiresAt !== undefined ||
      expiryTimer !== undefined ||
      signedInLogged
    ) {
      return unavailable();
    }
    requireRetainedLeaseUnexpired();
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
    if (request.url === '/healthz' && request.method === 'GET') {
      sendJson(response, 200, { status: 'ok', service: 'kemerbet-session-provision' });
      return;
    }
    if (request.url?.startsWith('/v1/session/frame?') && request.method === 'GET') {
      void serialized(async () => {
        try {
          const query = validFrameQuery(request.url);
          if (!query) {
            sendJson(response, 503, { error: 'session_unavailable' });
            return;
          }
          requireExpectedAccountId(query.platformAgentAccountId);
          if (
            checkpointedForRecheck ||
            query.generation !== sessionGeneration ||
            phase === 'idle' ||
            phase === 'checkpointed' ||
            phase === 'faulted'
          ) {
            sendJson(response, 503, { error: 'session_unavailable' });
            return;
          }
          const capturedAt = frameCapturedAtMs;
          const timestamp = now().getTime();
          const refreshDue =
            frameImage === undefined ||
            capturedAt === undefined ||
            timestamp < capturedAt ||
            timestamp - capturedAt >= FRAME_REFRESH_INTERVAL_MS;
          if (refreshDue && phase === 'login_required' && page) {
            // Once the cached frame is old, invalidate it before recapture. A failed screenshot
            // therefore locks input instead of accepting coordinates against a stale image.
            frameImage = undefined;
            frameCapturedAtMs = undefined;
            try {
              await captureLoginFrame(query.generation, page);
            } catch {
              // Preview capture is bounded and retryable. No input can be accepted without a
              // successfully captured generation-bound frame.
            }
          }
          if (frameImage === undefined || frameSequence <= query.after) {
            response.writeHead(204, {
              'cache-control': 'no-store, max-age=0',
              pragma: 'no-cache',
              'x-fetanagent-frame-sequence': String(frameSequence),
              'x-fetanagent-session-generation': query.generation,
            });
            response.end();
            return;
          }
          sendJpeg(response, query.generation, frameSequence, frameImage);
        } catch {
          if (!response.headersSent) sendJson(response, 503, { error: 'session_unavailable' });
          else response.destroy();
        }
      });
      return;
    }
    void serialized(async () => {
      try {
        if (request.url?.startsWith('/v1/session?') && request.method === 'GET') {
          const query = validStatusQuery(request.url);
          if (!query) return unavailable();
          requireExpectedAccountId(query.platformAgentAccountId);
          sendJson(response, 200, await status(query.platformAgentAccountId));
          return;
        }
        if (request.url === '/v1/session/start' && request.method === 'POST') {
          const candidate = validStartInput(await readJson(request));
          if (!candidate) return unavailable();
          sendJson(response, 202, start(candidate));
          return;
        }
        if (request.url === '/v1/session/input' && request.method === 'POST') {
          const candidate = validSessionInput(await readJson(request));
          if (!candidate) return unavailable();
          requireExpectedAccountId(candidate.platformAgentAccountId);
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
          const object = exactObject(await readJson(request), [
            'platformAgentAccountId',
            'requestId',
          ]);
          if (
            typeof object?.requestId !== 'string' ||
            !REQUEST_ID_PATTERN.test(object.requestId) ||
            typeof object.platformAgentAccountId !== 'string' ||
            !UUID_PATTERN.test(object.platformAgentAccountId)
          ) {
            return unavailable();
          }
          requireExpectedAccountId(object.platformAgentAccountId);
          beginStop();
          sendJson(response, 202, snapshot());
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
      await serialized(async () => {
        beginStop();
      });
      const cleanup = stopCleanupPromise;
      if (cleanup) await cleanup;
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
