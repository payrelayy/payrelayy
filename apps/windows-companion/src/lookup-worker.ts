import { lstat, mkdir, open, readFile, realpath, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isProxy } from 'node:util/types';

import {
  AGENT_PLATFORM_COMPANION_LOOKUP_POLL_PATH,
  AGENT_PLATFORM_COMPANION_LOOKUP_RESULT_PATH,
  AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  decodeSignedKemerBetExactFiveLookupResult,
  digestCompanionLookupPollContent,
  digestCompanionLookupResultContent,
  type SignedKemerBetExactFiveLookupAssignment,
  type SignedKemerBetExactFiveLookupResult,
} from '@fetanagent/agent-platform-companion-contracts';

import type {
  CompanionDeviceSigningRuntime,
  ExactFiveCompanionLookupOutcomes,
} from './device-enrollment.js';
import type { LocalKemerBetSession } from './local-kemerbet-session.js';
import {
  createWindowsCurrentUserDataProtector,
  type WindowsCurrentUserDataProtector,
} from './windows-data-protection.js';

const ASSIGNMENT_FILE = 'lookup-primary.assignment.secure.json';
const STARTED_FILE = 'lookup-primary.started.json';
const RESULT_FILE = 'lookup-primary.result.secure.json';
const MAXIMUM_LEDGER_BYTES = 4_096;
const MAXIMUM_RESPONSE_BYTES = 64 * 1_024;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export type CompanionLookupWorkerState =
  | 'waiting_for_assignment'
  | 'assignment_verified'
  | 'lookup_completed'
  | 'result_accepted'
  | 'assignment_expired'
  | 'temporarily_unavailable'
  | 'failed_closed';

export interface CompanionLookupWorkerEvent {
  readonly state: CompanionLookupWorkerState;
  readonly foundCount?: number;
  readonly reviewRequiredCount?: number;
  readonly detailsRedacted: true;
  readonly identifiersRedacted: true;
  readonly transferDisabled: true;
  readonly moneyMoved: false;
}

export interface CompanionLookupWorkerOptions {
  readonly dataRoot: string;
  readonly device: CompanionDeviceSigningRuntime;
  readonly session: Pick<LocalKemerBetSession, 'executeExactFiveLookup'>;
  readonly signal: AbortSignal;
  readonly report: (event: CompanionLookupWorkerEvent) => void;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly pollIntervalMs?: number;
  readonly protector?: WindowsCurrentUserDataProtector;
}

export class CompanionLookupWorkerError extends Error {
  constructor() {
    super('The signed exact-five companion lookup failed closed.');
    this.name = 'CompanionLookupWorkerError';
  }
}

function unavailable(): never {
  throw new CompanionLookupWorkerError();
}

function plainRecord(candidate: unknown): candidate is Record<string, unknown> {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    !Array.isArray(candidate) &&
    !isProxy(candidate) &&
    Object.getPrototypeOf(candidate) === Object.prototype
  );
}

function exactKeys(candidate: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(candidate).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

async function stableDeviceRoot(dataRoot: string): Promise<string> {
  const deviceRoot = resolve(dataRoot, 'device');
  await mkdir(deviceRoot, { recursive: true });
  const [stat, canonicalDataRoot, canonicalDeviceRoot] = await Promise.all([
    lstat(deviceRoot),
    realpath(dataRoot),
    realpath(deviceRoot),
  ]);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    canonicalDeviceRoot.toLocaleLowerCase('en-US') !==
      resolve(canonicalDataRoot, 'device').toLocaleLowerCase('en-US')
  ) {
    unavailable();
  }
  return deviceRoot;
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 16_384) {
      unavailable();
    }
    return await readFile(path, 'utf8');
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    if (error instanceof CompanionLookupWorkerError) throw error;
    return unavailable();
  }
}

async function writeExclusive(path: string, value: unknown): Promise<void> {
  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
    await handle.sync();
  } catch {
    unavailable();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function protectValue(
  path: string,
  kind: 'assignment' | 'result',
  value: unknown,
  protector: WindowsCurrentUserDataProtector,
): Promise<void> {
  const clear = Buffer.from(JSON.stringify({ ledgerVersion: 1, kind, value }), 'utf8');
  let protectedBytes: Buffer | undefined;
  try {
    if (clear.byteLength < 1 || clear.byteLength > MAXIMUM_LEDGER_BYTES) unavailable();
    protectedBytes = await protector.protect(clear);
    await writeExclusive(path, {
      ledgerVersion: 1,
      protection: 'windows-dpapi-current-user',
      protectedPayloadBase64: protectedBytes.toString('base64'),
    });
  } finally {
    clear.fill(0);
    protectedBytes?.fill(0);
  }
}

async function unprotectValue(
  path: string,
  expectedKind: 'assignment' | 'result',
  protector: WindowsCurrentUserDataProtector,
): Promise<unknown | undefined> {
  const raw = await readOptional(path);
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return unavailable();
  }
  if (
    !plainRecord(parsed) ||
    !exactKeys(parsed, ['ledgerVersion', 'protection', 'protectedPayloadBase64']) ||
    parsed.ledgerVersion !== 1 ||
    parsed.protection !== 'windows-dpapi-current-user' ||
    typeof parsed.protectedPayloadBase64 !== 'string' ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(parsed.protectedPayloadBase64)
  ) {
    return unavailable();
  }
  const protectedBytes = Buffer.from(parsed.protectedPayloadBase64, 'base64');
  let clear: Buffer | undefined;
  try {
    if (
      protectedBytes.byteLength < 1 ||
      protectedBytes.byteLength > MAXIMUM_LEDGER_BYTES ||
      protectedBytes.toString('base64') !== parsed.protectedPayloadBase64
    ) {
      return unavailable();
    }
    clear = await protector.unprotect(protectedBytes);
    if (clear.byteLength < 1 || clear.byteLength > MAXIMUM_LEDGER_BYTES) return unavailable();
    const payload = JSON.parse(clear.toString('utf8')) as unknown;
    if (
      !plainRecord(payload) ||
      !exactKeys(payload, ['ledgerVersion', 'kind', 'value']) ||
      payload.ledgerVersion !== 1 ||
      payload.kind !== expectedKind
    ) {
      return unavailable();
    }
    return payload.value;
  } catch (error) {
    if (error instanceof CompanionLookupWorkerError) throw error;
    return unavailable();
  } finally {
    protectedBytes.fill(0);
    clear?.fill(0);
  }
}

async function responseBytes(response: Response): Promise<Buffer> {
  const declared = response.headers.get('content-length');
  if (
    declared !== null &&
    (!/^[1-9][0-9]{0,5}$/u.test(declared) || Number(declared) > MAXIMUM_RESPONSE_BYTES)
  ) {
    unavailable();
  }
  if (!response.body) unavailable();
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAXIMUM_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        unavailable();
      }
      chunks.push(Buffer.from(part.value));
    }
    if (total < 1 || (declared !== null && total !== Number(declared))) unavailable();
    return Buffer.concat(chunks, total);
  } finally {
    for (const chunk of chunks) chunk.fill(0);
    reader.releaseLock();
  }
}

async function parsedResponse(response: Response): Promise<Record<string, unknown>> {
  if (response.headers.get('content-type') !== AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE) {
    unavailable();
  }
  const bytes = await responseBytes(response);
  try {
    const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    if (!plainRecord(parsed)) unavailable();
    return parsed;
  } catch (error) {
    if (error instanceof CompanionLookupWorkerError) throw error;
    return unavailable();
  } finally {
    bytes.fill(0);
  }
}

async function post(
  endpoint: string,
  body: unknown,
  fetchImplementation: typeof fetch,
  signal: AbortSignal,
): Promise<Response> {
  try {
    return await fetchImplementation(endpoint, {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      headers: {
        accept: AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
        'content-type': AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    return unavailable();
  }
}

async function pollAssignment(
  device: CompanionDeviceSigningRuntime,
  fetchImplementation: typeof fetch,
  signal: AbortSignal,
  now: Date,
): Promise<SignedKemerBetExactFiveLookupAssignment | undefined> {
  const contentDigest = digestCompanionLookupPollContent(device.certificate.bodyDigest);
  if (!contentDigest) unavailable();
  const httpRequest = device.createSignedHttpRequest(
    AGENT_PLATFORM_COMPANION_LOOKUP_POLL_PATH,
    contentDigest,
    now,
  );
  const response = await post(
    device.pollEndpoint,
    { certificate: device.certificate, httpRequest },
    fetchImplementation,
    signal,
  );
  if (response.status === 204) {
    if (response.body !== null || response.headers.get('content-type') !== null) unavailable();
    return undefined;
  }
  if (response.status !== 200) unavailable();
  const parsed = await parsedResponse(response);
  if (!exactKeys(parsed, ['assignment'])) unavailable();
  const assignment = device.decodeAndVerifyAssignment(parsed.assignment, now);
  return assignment ?? unavailable();
}

async function submitResult(
  device: CompanionDeviceSigningRuntime,
  assignment: SignedKemerBetExactFiveLookupAssignment,
  result: SignedKemerBetExactFiveLookupResult,
  fetchImplementation: typeof fetch,
  signal: AbortSignal,
  now: Date,
): Promise<void> {
  const contentDigest = digestCompanionLookupResultContent(assignment, result);
  if (!contentDigest || !device.verifyLookupExchange(assignment, result, now)) {
    unavailable();
  }
  const httpRequest = device.createSignedHttpRequest(
    AGENT_PLATFORM_COMPANION_LOOKUP_RESULT_PATH,
    contentDigest,
    now,
  );
  const response = await post(
    device.resultEndpoint,
    {
      certificate: device.certificate,
      httpRequest,
      signedAssignment: assignment,
      signedResult: result,
    },
    fetchImplementation,
    signal,
  );
  if (response.status !== 200 && response.status !== 201) unavailable();
  const parsed = await parsedResponse(response);
  if (
    !exactKeys(parsed, ['accepted', 'replayed']) ||
    parsed.accepted !== true ||
    typeof parsed.replayed !== 'boolean'
  ) {
    unavailable();
  }
}

async function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolvePromise) => {
    const timer = setTimeout(resolvePromise, ms);
    timer.unref();
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolvePromise();
      },
      { once: true },
    );
  });
}

async function clearLedger(deviceRoot: string): Promise<void> {
  await Promise.all(
    [ASSIGNMENT_FILE, STARTED_FILE, RESULT_FILE].map((name) =>
      rm(resolve(deviceRoot, name), { force: true }),
    ),
  );
}

function allReviewRequired(): ExactFiveCompanionLookupOutcomes {
  return Object.freeze([
    'review_required',
    'review_required',
    'review_required',
    'review_required',
    'review_required',
  ]);
}

/** Continuously performs only server-signed, exact-five, read-only Player-ID lookups. */
export async function runCompanionLookupWorker(
  options: CompanionLookupWorkerOptions,
): Promise<void> {
  const fetchImplementation = options.fetch ?? fetch;
  const nowProvider = options.now ?? (() => new Date());
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 100 || pollIntervalMs > 60_000) {
    unavailable();
  }
  const protector =
    options.protector ?? createWindowsCurrentUserDataProtector(process.env, 'lookup-ledger');
  const deviceRoot = await stableDeviceRoot(options.dataRoot);
  const assignmentPath = resolve(deviceRoot, ASSIGNMENT_FILE);
  const startedPath = resolve(deviceRoot, STARTED_FILE);
  const resultPath = resolve(deviceRoot, RESULT_FILE);

  while (!options.signal.aborted) {
    try {
      const now = nowProvider();
      let assignmentCandidate = await unprotectValue(assignmentPath, 'assignment', protector);
      let assignment =
        assignmentCandidate === undefined
          ? undefined
          : options.device.decodeAndVerifyAssignment(assignmentCandidate, now);
      assignmentCandidate = undefined;
      if (!assignment && (await readOptional(assignmentPath)) !== undefined) {
        options.report({
          state: 'assignment_expired',
          detailsRedacted: true,
          identifiersRedacted: true,
          transferDisabled: true,
          moneyMoved: false,
        });
        await clearLedger(deviceRoot);
      }

      if (!assignment) {
        assignment = await pollAssignment(options.device, fetchImplementation, options.signal, now);
        if (!assignment) {
          options.report({
            state: 'waiting_for_assignment',
            detailsRedacted: true,
            identifiersRedacted: true,
            transferDisabled: true,
            moneyMoved: false,
          });
          await waitFor(pollIntervalMs, options.signal);
          continue;
        }
        await protectValue(assignmentPath, 'assignment', assignment, protector);
        options.report({
          state: 'assignment_verified',
          detailsRedacted: true,
          identifiersRedacted: true,
          transferDisabled: true,
          moneyMoved: false,
        });
      }

      const storedResultCandidate = await unprotectValue(resultPath, 'result', protector);
      let result = decodeSignedKemerBetExactFiveLookupResult(storedResultCandidate);
      if (
        storedResultCandidate !== undefined &&
        (!result || !options.device.verifyLookupExchange(assignment, result, now))
      ) {
        unavailable();
      }
      if (!result) {
        const startedRaw = await readOptional(startedPath);
        let outcomes: ExactFiveCompanionLookupOutcomes;
        if (startedRaw !== undefined) {
          let started: unknown;
          try {
            started = JSON.parse(startedRaw);
          } catch {
            unavailable();
          }
          if (
            !plainRecord(started) ||
            !exactKeys(started, ['assignmentBodyDigest', 'ledgerVersion']) ||
            started.ledgerVersion !== 1 ||
            started.assignmentBodyDigest !== assignment.bodyDigest ||
            typeof started.assignmentBodyDigest !== 'string' ||
            !DIGEST_PATTERN.test(started.assignmentBodyDigest)
          ) {
            unavailable();
          }
          outcomes = allReviewRequired();
        } else {
          await writeExclusive(startedPath, {
            ledgerVersion: 1,
            assignmentBodyDigest: assignment.bodyDigest,
          });
          try {
            outcomes = await options.session.executeExactFiveLookup(assignment.body.playerIds);
          } catch {
            outcomes = allReviewRequired();
          }
        }
        const observedAt = nowProvider();
        result = options.device.createSignedLookupResult(assignment, outcomes, observedAt);
        await protectValue(resultPath, 'result', result, protector);
        options.report({
          state: 'lookup_completed',
          foundCount: result.body.foundCount,
          reviewRequiredCount: result.body.reviewRequiredCount,
          detailsRedacted: true,
          identifiersRedacted: true,
          transferDisabled: true,
          moneyMoved: false,
        });
      }

      await submitResult(
        options.device,
        assignment,
        result,
        fetchImplementation,
        options.signal,
        nowProvider(),
      );
      options.report({
        state: 'result_accepted',
        foundCount: result.body.foundCount,
        reviewRequiredCount: result.body.reviewRequiredCount,
        detailsRedacted: true,
        identifiersRedacted: true,
        transferDisabled: true,
        moneyMoved: false,
      });
      await clearLedger(deviceRoot);
    } catch {
      if (options.signal.aborted) return;
      options.report({
        state: 'temporarily_unavailable',
        detailsRedacted: true,
        identifiersRedacted: true,
        transferDisabled: true,
        moneyMoved: false,
      });
      await waitFor(Math.max(pollIntervalMs, 5_000), options.signal);
    }
  }
}
