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
import { chromium, type BrowserContext, type Page, type Route } from 'playwright-core';

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
  KEMERBET_AGENT_DEPOSIT_URL,
  observeKemerBetAgentIdentityFingerprint,
  type KemerBetAgentIdentityObservationStage,
  type KemerBetAgentPageSelectorContractV2,
} from './playwright-kemerbet-agent-page.js';

const OUTPUT_ROOT = '/run/fetanagent-kemerbet-readiness-seal-output';
const OUTPUT_FILE = `${OUTPUT_ROOT}/kemerbet_agent_identity_bindings`;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const FINGERPRINT_PATTERN = /^hmac-sha256-agent-identity-v1:[0-9a-f]{64}$/u;
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
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
  | 'lookup_action'
  | 'lookup_response'
  | 'lookup_contract'
  | 'lookup_result'
  | 'binding_write';

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

export function isAllowedKemerBetReadinessSealRequest(input: {
  readonly isMainFrame: boolean;
  readonly isNavigationRequest: boolean;
  readonly method: string;
  readonly requestUrl: string;
}): boolean {
  let url: URL;
  try {
    url = new URL(input.requestUrl);
  } catch {
    return false;
  }
  if (
    !READ_METHODS.has(input.method) ||
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== ''
  ) {
    return false;
  }
  if (input.isMainFrame || input.isNavigationRequest) {
    return input.isMainFrame && url.href === KEMERBET_AGENT_DEPOSIT_URL;
  }
  return true;
}

async function guardedRoute(route: Route, page: Page): Promise<void> {
  const request = route.request();
  if (
    !isAllowedKemerBetReadinessSealRequest({
      isMainFrame: request.frame() === page.mainFrame(),
      isNavigationRequest: request.isNavigationRequest(),
      method: request.method(),
      requestUrl: request.url(),
    })
  ) {
    await route.abort('blockedbyclient');
    return;
  }
  await route.continue();
}

/**
 * Build the five-lookup probe on an already-authenticated page. The extra route is installed for
 * the proof lifetime so every request is read-only even when the page belongs to the manual
 * sign-in service whose authenticated state exists only inside the current Chromium process.
 */
export async function createKemerBetNoTransferReadinessSealProbeFromPage(options: {
  readonly accountId: string;
  readonly close: () => Promise<void>;
  readonly fingerprintAgentIdentity: KemerBetAgentIdentityFingerprinter;
  readonly page: Page;
  readonly reportStage?: (stage: KemerBetNoTransferReadinessSealStage) => void;
  readonly selectorContract: KemerBetAgentPageSelectorContractV2;
}): Promise<KemerBetNoTransferReadinessSealProbe> {
  const reportStage = options.reportStage ?? (() => undefined);
  const readinessRoute = (route: Route) => guardedRoute(route, options.page);
  let routeInstalled = false;
  let probeReturned = false;
  const close = async (): Promise<void> => {
    if (routeInstalled) {
      routeInstalled = false;
      await options.page.unroute('**/*', readinessRoute).catch(() => undefined);
    }
    await options.close();
  };
  try {
    // The supervised sign-in service owns this already-authenticated page. Do not
    // reload it: KemerBet may keep part of the authenticated dashboard state in
    // the live document, and a navigation would discard the exact session that
    // the Owner just established. The caller and the checks below both require
    // the page to remain on the canonical Agent dashboard for the whole proof.
    reportStage('route_guard');
    if (options.page.url() !== KEMERBET_AGENT_DEPOSIT_URL) unavailable();
    await options.page.route('**/*', readinessRoute);
    routeInstalled = true;
    if (options.page.url() !== KEMERBET_AGENT_DEPOSIT_URL) unavailable();
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
      activateReadOnlyLookupWithoutPointer: true,
      timeoutMs: 30_000,
      reportLookupStage: (stage) => options.reportStage?.(stage),
    });
    await agentPage.adoptCurrentDepositPageWithoutNavigation();
    probeReturned = true;
    return {
      observedAgentIdentityFingerprint,
      probePlayerLookup: async (target) => {
        if (target.currencyCode !== 'ETB') unavailable();
        reportStage('lookup_surface');
        await agentPage.openPlayerDeposit();
        reportStage('lookup_request');
        await agentPage.lookupPlayer(target.playerId);
        if ((await agentPage.currentUrl()) !== KEMERBET_AGENT_DEPOSIT_URL) unavailable();
        reportStage('lookup_result');
        const lookup = await agentPage.readAgentLookup();
        if (lookup.playerId !== target.playerId || lookup.currencyCode !== target.currencyCode) {
          unavailable();
        }
        return {
          exactPlayerMatch: true,
          exactCurrencyMatch: true,
          transferDisabled: true,
        };
      },
      close,
    };
  } catch {
    return unavailable();
  } finally {
    if (!probeReturned) await close().catch(() => undefined);
  }
}

async function productionOpenProbe(options: {
  readonly accountId: string;
  readonly selectorContract: KemerBetAgentPageSelectorContractV2;
  readonly fingerprintAgentIdentity: KemerBetAgentIdentityFingerprinter;
  readonly effectiveUserId: number;
  readonly reportStage: (stage: KemerBetNoTransferReadinessSealStage) => void;
}): Promise<KemerBetNoTransferReadinessSealProbe> {
  const profile = await resolveSafeProfile(options.accountId, options.effectiveUserId);
  await removeStaleChromiumSingletonArtifacts(profile);
  await assertSafeDirectory(profile, options.effectiveUserId, 0o700);
  let context: BrowserContext | null = null;
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
      serviceWorkers: 'block',
      viewport: { width: 1280, height: 720 },
    });
    const pages = context.pages();
    const firstPage = pages[0];
    const page =
      pages.length === 1 && firstPage !== undefined
        ? firstPage
        : pages.length === 0
          ? await context.newPage()
          : null;
    if (page === null) return unavailable();
    context.on('page', (openedPage) => {
      if (openedPage !== page) void openedPage.close().catch(() => undefined);
    });
    const retainedContext = context;
    return await createKemerBetNoTransferReadinessSealProbeFromPage({
      accountId: options.accountId,
      fingerprintAgentIdentity: options.fingerprintAgentIdentity,
      page,
      reportStage: options.reportStage,
      selectorContract: options.selectorContract,
      close: async () => {
        await retainedContext.close();
      },
    });
  } catch {
    await context?.close().catch(() => undefined);
    return unavailable();
  }
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
