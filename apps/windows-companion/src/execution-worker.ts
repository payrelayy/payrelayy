import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { isProxy } from 'node:util/types';

import { AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE } from '@fetanagent/agent-platform-companion-contracts';
import {
  COMPANION_EXECUTION_ACTION_KIND,
  COMPANION_EXECUTION_AUTHORITY_PATH,
  COMPANION_EXECUTION_CAPABILITY,
  COMPANION_EXECUTION_CONTRACT_VERSION,
  COMPANION_EXECUTION_CURRENCY_CODE,
  COMPANION_EXECUTION_MAX_FORWARD_CLOCK_SKEW_MS,
  COMPANION_EXECUTION_POLL_PATH,
  COMPANION_EXECUTION_PROTOCOL_MODE,
  COMPANION_EXECUTION_RESULT_PATH,
  COMPANION_EXECUTION_STATUS_PATH,
  digestCompanionExecutionAuthorityRequestContent,
  digestCompanionExecutionNonce,
  digestCompanionExecutionPollContent,
  digestCompanionExecutionResultContent,
  digestCompanionExecutionStatusQueryContent,
  recheckOneUseActionAuthorityDeadlineAfterAtomicConsumption,
  type ExecutionResultBody,
  type SignedAuthoritativeExecutionStatus,
  type SignedExecutionResult,
  type SignedOneUseActionAuthority,
  type TrustedRoundTripContext,
} from '@fetanagent/agent-platform-companion-execution-contracts';

import type {
  CompanionExecutionSignedChain,
  CompanionDeviceSigningRuntime,
  VerifiedCompanionExecutionAssignment,
} from './device-enrollment.js';
import {
  clearWindowsCompanionExecutionV2PreFenceAttemptChain,
  clearWindowsCompanionExecutionV2TerminalAttemptChain,
  loadWindowsCompanionExecutionV2AttemptChain,
  persistWindowsCompanionExecutionV2AttemptAuthority,
  persistWindowsCompanionExecutionV2AttemptResult,
  persistWindowsCompanionExecutionV2InitialAttemptChain,
  type WindowsCompanionExecutionV2AttemptChain,
  type WindowsCompanionExecutionV2AttemptStoreOptions,
} from './execution-v2-attempt-store.js';
import {
  assessWindowsCompanionExecutionV2Recovery,
  clearWindowsCompanionExecutionV2PreFenceEvidence,
  clearWindowsCompanionExecutionV2TerminalEvidence,
  createWindowsCompanionExecutionV2AssignmentEvidence,
  persistWindowsCompanionExecutionV2CrashEvidence,
  recordWindowsCompanionExecutionV2FenceConsumptionEvidence,
  recordWindowsCompanionExecutionV2FinalActionStartedEvidence,
  recordWindowsCompanionExecutionV2SignedResultEvidence,
  type WindowsCompanionExecutionV2CrashEvidence,
} from './execution-v2-crash-journal.js';
import { consumeWindowsCompanionExecutionV2AuthorityOnce } from './execution-v2-replay-store.js';
import type { LocalKemerBetSession } from './local-kemerbet-session.js';
import type { WindowsCurrentUserDataProtector } from './windows-data-protection.js';

const MAXIMUM_RESPONSE_BYTES = 128 * 1_024;
const DEFAULT_POLL_INTERVAL_MS = 2_000;

export type CompanionExecutionWorkerState =
  | 'waiting_for_assignment'
  | 'assignment_verified'
  | 'provider_prepared'
  | 'database_fence_consumed'
  | 'final_action_started'
  | 'result_recorded'
  | 'result_accepted'
  | 'reconciliation_pending'
  | 'reconciliation_succeeded'
  | 'reconciliation_failed'
  | 'reconciliation_uncertain'
  | 'temporarily_unavailable'
  | 'failed_closed';

export interface CompanionExecutionWorkerEvent {
  readonly state: CompanionExecutionWorkerState;
  readonly detailsRedacted: true;
  readonly identifiersRedacted: true;
  readonly amountMinorUnits: 2500;
  readonly currencyCode: 'ETB';
  readonly moneyMovedLocally: 'not_observed' | 'submission_attempted' | 'uncertain';
}

export interface CompanionExecutionWorkerOptions {
  readonly dataRoot: string;
  readonly device: CompanionDeviceSigningRuntime;
  readonly session: Pick<LocalKemerBetSession, 'executeExactOneUseDeposit'>;
  readonly signal: AbortSignal;
  readonly report: (event: CompanionExecutionWorkerEvent) => void;
  readonly fetch?: typeof fetch;
  readonly localNow?: () => Date;
  readonly monotonicNow?: () => number;
  readonly pollIntervalMs?: number;
  readonly protector?: WindowsCurrentUserDataProtector;
}

interface TimedResponse {
  readonly response: Response;
  readonly trustedResponseTime: Date;
  readonly roundTrip: TrustedRoundTripContext;
}

type UnknownRecord = Record<string, unknown>;

export class CompanionExecutionWorkerError extends Error {
  constructor() {
    super('The companion one-use execution worker failed closed.');
    this.name = 'CompanionExecutionWorkerError';
  }
}

function unavailable(): never {
  throw new CompanionExecutionWorkerError();
}

function plainRecord(candidate: unknown): candidate is UnknownRecord {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    !Array.isArray(candidate) &&
    !isProxy(candidate) &&
    Object.getPrototypeOf(candidate) === Object.prototype
  );
}

function exactKeys(candidate: UnknownRecord, expected: readonly string[]): boolean {
  const actual = Reflect.ownKeys(candidate);
  return (
    actual.length === expected.length &&
    actual.every((key) => typeof key === 'string' && expected.includes(key)) &&
    expected.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
    })
  );
}

function validDate(candidate: Date): Date {
  if (!Number.isFinite(candidate.getTime())) unavailable();
  return candidate;
}

async function responseBytes(response: Response): Promise<Buffer> {
  const declared = response.headers.get('content-length');
  if (
    declared !== null &&
    (!/^[1-9][0-9]{0,6}$/u.test(declared) || Number(declared) > MAXIMUM_RESPONSE_BYTES)
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

async function parsedResponse(response: Response): Promise<UnknownRecord> {
  if (response.headers.get('content-type') !== AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE) {
    unavailable();
  }
  const bytes = await responseBytes(response);
  try {
    const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    return plainRecord(parsed) ? parsed : unavailable();
  } catch (error) {
    if (error instanceof CompanionExecutionWorkerError) throw error;
    return unavailable();
  } finally {
    bytes.fill(0);
  }
}

async function postTimed(
  endpoint: string,
  body: unknown,
  fetchImplementation: typeof fetch,
  signal: AbortSignal,
  monotonicNow: () => number,
): Promise<TimedResponse> {
  const monotonicRequestStartedMs = monotonicNow();
  if (!Number.isSafeInteger(monotonicRequestStartedMs) || monotonicRequestStartedMs < 0) {
    unavailable();
  }
  let response: Response;
  try {
    response = await fetchImplementation(endpoint, {
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
  const monotonicResponseReceivedMs = monotonicNow();
  const dateHeader = response.headers.get('date');
  const trustedResponseTime = dateHeader === null ? new Date(Number.NaN) : new Date(dateHeader);
  if (
    !Number.isSafeInteger(monotonicResponseReceivedMs) ||
    monotonicResponseReceivedMs < monotonicRequestStartedMs ||
    !Number.isFinite(trustedResponseTime.getTime())
  ) {
    return unavailable();
  }
  return Object.freeze({
    response,
    trustedResponseTime,
    roundTrip: Object.freeze({ monotonicRequestStartedMs, monotonicResponseReceivedMs }),
  });
}

function estimatedTrustedNow(timed: TimedResponse, monotonicNow: () => number): Date {
  const current = monotonicNow();
  if (!Number.isSafeInteger(current) || current < timed.roundTrip.monotonicResponseReceivedMs) {
    unavailable();
  }
  return validDate(
    new Date(
      timed.trustedResponseTime.getTime() + current - timed.roundTrip.monotonicResponseReceivedMs,
    ),
  );
}

async function waitFor(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolvePromise) => {
    const timer = setTimeout(resolvePromise, milliseconds);
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

function event(
  state: CompanionExecutionWorkerState,
  moneyMovedLocally: CompanionExecutionWorkerEvent['moneyMovedLocally'] = 'not_observed',
): CompanionExecutionWorkerEvent {
  return Object.freeze({
    state,
    detailsRedacted: true,
    identifiersRedacted: true,
    amountMinorUnits: 2500,
    currencyCode: 'ETB',
    moneyMovedLocally,
  });
}

function evidenceDigest(
  chain: VerifiedCompanionExecutionAssignment,
  authority: SignedOneUseActionAuthority,
  outcome: 'submission_attempted' | 'local_uncertain' | 'post_fence_no_local_action',
  finalActionStartedAt: string | null,
  providerResponseDigest: string | null,
  reportedAt: string,
): string {
  return `sha256:${createHash('sha256')
    .update('fetanagent\0windows-companion\0execution-result-evidence\0v2\0', 'utf8')
    .update(
      JSON.stringify([
        chain.assignment.bodyDigest,
        authority.bodyDigest,
        outcome,
        finalActionStartedAt,
        providerResponseDigest,
        reportedAt,
      ]),
      'utf8',
    )
    .digest('hex')}`;
}

function executionResultBody(
  chain: VerifiedCompanionExecutionAssignment,
  authority: SignedOneUseActionAuthority,
  outcome: 'submission_attempted' | 'local_uncertain' | 'post_fence_no_local_action',
  finalActionStartedAt: string | null,
  providerResponseDigest: string | null,
  reportedAt: string,
): ExecutionResultBody {
  const assignment = chain.assignment.body;
  return Object.freeze({
    contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
    protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
    capability: COMPANION_EXECUTION_CAPABILITY,
    actionKind: COMPANION_EXECUTION_ACTION_KIND,
    resultId: randomUUID(),
    assignmentId: assignment.assignmentId,
    assignmentBodyDigest: chain.assignment.bodyDigest,
    authorityId: authority.body.authorityId,
    authorityBodyDigest: authority.bodyDigest,
    activationEpoch: assignment.activationEpoch,
    intentId: assignment.intentId,
    jobId: assignment.jobId,
    attemptId: assignment.attemptId,
    platformAgentAccountId: assignment.platformAgentAccountId,
    enrollmentId: assignment.enrollmentId,
    enrollmentBodyDigest: assignment.enrollmentBodyDigest,
    noMoneyCertificateId: assignment.noMoneyCertificateId,
    noMoneyCertificateBodyDigest: assignment.noMoneyCertificateBodyDigest,
    deviceId: assignment.deviceId,
    deviceKeyId: assignment.deviceKeyId,
    executionSignerKeyId: assignment.executionSignerKeyId,
    platformCode: assignment.platformCode,
    pilotId: assignment.pilotId,
    pilotRevision: assignment.pilotRevision,
    pilotConfigDigest: assignment.pilotConfigDigest,
    pilotReservationId: assignment.pilotReservationId,
    pilotReservationDigest: assignment.pilotReservationDigest,
    amountMinorUnits: 2500,
    currencyCode: COMPANION_EXECUTION_CURRENCY_CODE,
    playerIdDigest: assignment.playerIdDigest,
    fenceId: authority.body.fenceId,
    fenceNonceDigest: authority.body.fenceNonceDigest,
    requestNonceDigest: authority.body.requestNonceDigest,
    outcome,
    finalActionStarted: finalActionStartedAt !== null,
    finalActionStartedAt,
    providerResponseDigest,
    evidenceDigest: evidenceDigest(
      chain,
      authority,
      outcome,
      finalActionStartedAt,
      providerResponseDigest,
      reportedAt,
    ),
    reportedAt,
  });
}

async function queryStatus(
  options: CompanionExecutionWorkerOptions,
  chain: CompanionExecutionSignedChain,
  authority: SignedOneUseActionAuthority,
  result: SignedExecutionResult,
  fetchImplementation: typeof fetch,
  monotonicNow: () => number,
  issuedAt: Date,
): Promise<{
  readonly status: SignedAuthoritativeExecutionStatus;
  readonly timed: TimedResponse;
}> {
  const runtime = options.device.execution ?? unavailable();
  const nonce = randomBytes(32);
  let queryNonceDigest: string;
  try {
    queryNonceDigest = digestCompanionExecutionNonce(nonce) ?? unavailable();
  } finally {
    nonce.fill(0);
  }
  const contentDigest =
    digestCompanionExecutionStatusQueryContent(
      chain.enrollment,
      chain.assignment,
      queryNonceDigest,
    ) ?? unavailable();
  const httpRequest = options.device.createSignedHttpRequest(
    COMPANION_EXECUTION_STATUS_PATH,
    contentDigest,
    validDate(issuedAt),
  );
  const timed = await postTimed(
    runtime.statusEndpoint,
    {
      certificate: options.device.certificate,
      httpRequest,
      enrollment: chain.enrollment,
      assignment: chain.assignment,
      authority,
      result,
      queryNonceDigest,
    },
    fetchImplementation,
    options.signal,
    monotonicNow,
  );
  if (timed.response.status !== 200 && timed.response.status !== 201) unavailable();
  const parsed = await parsedResponse(timed.response);
  if (!exactKeys(parsed, ['status'])) unavailable();
  const status =
    runtime.verifyStatus(
      parsed.status,
      chain,
      authority,
      result,
      queryNonceDigest,
      '1',
      timed.trustedResponseTime,
      timed.roundTrip,
    ) ?? unavailable();
  return Object.freeze({ status, timed });
}

async function reconcileRecordedAttempt(
  options: CompanionExecutionWorkerOptions,
  chain: WindowsCompanionExecutionV2AttemptChain,
  journal: WindowsCompanionExecutionV2CrashEvidence,
  fetchImplementation: typeof fetch,
  monotonicNow: () => number,
  pollIntervalMs: number,
  journalOptions: WindowsCompanionExecutionV2AttemptStoreOptions & {
    readonly protector?: WindowsCurrentUserDataProtector;
  },
  initialTrustedTimeAnchor?: TimedResponse,
): Promise<'cleared' | 'stopped'> {
  if (
    journal.phase !== 'signed_result_recorded_reconciliation_required' ||
    chain.authority === null ||
    chain.result === null ||
    journal.assignmentId !== chain.assignment.body.assignmentId ||
    journal.assignmentBodyDigest !== chain.assignment.bodyDigest ||
    journal.authorityId !== chain.authority.body.authorityId ||
    journal.authorityBodyDigest !== chain.authority.bodyDigest ||
    journal.resultBodyDigest !== chain.result.bodyDigest
  ) {
    unavailable();
  }
  const localMoneyState: CompanionExecutionWorkerEvent['moneyMovedLocally'] =
    chain.result.body.outcome === 'submission_attempted' ? 'submission_attempted' : 'uncertain';
  let trustedTimeAnchor = initialTrustedTimeAnchor;
  while (!options.signal.aborted) {
    const query = await queryStatus(
      options,
      chain,
      chain.authority,
      chain.result,
      fetchImplementation,
      monotonicNow,
      trustedTimeAnchor
        ? estimatedTrustedNow(trustedTimeAnchor, monotonicNow)
        : validDate((options.localNow ?? (() => new Date()))()),
    );
    trustedTimeAnchor = query.timed;
    const status = query.status;
    if (status.body.terminalState === 'succeeded') {
      await clearWindowsCompanionExecutionV2TerminalEvidence(journal, status, journalOptions);
      await clearWindowsCompanionExecutionV2TerminalAttemptChain(chain, journalOptions);
      options.report(event('reconciliation_succeeded', localMoneyState));
      return 'cleared';
    }
    if (status.body.terminalState === 'failed') {
      await clearWindowsCompanionExecutionV2TerminalEvidence(journal, status, journalOptions);
      await clearWindowsCompanionExecutionV2TerminalAttemptChain(chain, journalOptions);
      options.report(event('reconciliation_failed', localMoneyState));
      return 'cleared';
    }
    if (status.body.terminalState === 'uncertain') {
      options.report(event('reconciliation_uncertain', 'uncertain'));
      while (!options.signal.aborted) {
        await waitFor(Math.max(pollIntervalMs, 5_000), options.signal);
      }
      return 'stopped';
    }
    options.report(event('reconciliation_pending', localMoneyState));
    await waitFor(pollIntervalMs, options.signal);
  }
  return 'stopped';
}

/**
 * Runs the opt-in one-use execution lane. Any durable post-fence evidence forces reconciliation;
 * no exception, timeout, response replay, or process restart can trigger a blind provider retry.
 */
export async function runCompanionExecutionWorker(
  options: CompanionExecutionWorkerOptions,
): Promise<void> {
  const runtime = options.device.execution;
  if (!runtime) return unavailable();
  const fetchImplementation = options.fetch ?? fetch;
  const localNow = options.localNow ?? (() => new Date());
  const monotonicNow = options.monotonicNow ?? (() => Math.floor(performance.now()));
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 250 || pollIntervalMs > 60_000) {
    unavailable();
  }
  const journalOptions = {
    dataRoot: options.dataRoot,
    ...(options.protector === undefined ? {} : { protector: options.protector }),
  };
  const recovery = await assessWindowsCompanionExecutionV2Recovery({
    ...journalOptions,
    minimumExpectedJournalRevision: 0,
  });
  const attemptRecovery = await loadWindowsCompanionExecutionV2AttemptChain(journalOptions);
  if (recovery.localEvidenceState !== 'missing' || attemptRecovery.state !== 'missing') {
    if (
      recovery.localEvidenceState === 'locally_consistent_untrusted' &&
      recovery.localEvidence !== null &&
      attemptRecovery.state === 'available' &&
      recovery.localEvidence.phase === 'signed_result_recorded_reconciliation_required' &&
      attemptRecovery.chain.authority !== null &&
      attemptRecovery.chain.result !== null
    ) {
      try {
        const disposition = await reconcileRecordedAttempt(
          options,
          attemptRecovery.chain,
          recovery.localEvidence,
          fetchImplementation,
          monotonicNow,
          pollIntervalMs,
          journalOptions,
        );
        if (disposition === 'stopped') return;
      } catch {
        options.report(event('failed_closed', 'uncertain'));
        while (!options.signal.aborted) {
          await waitFor(Math.max(pollIntervalMs, 5_000), options.signal);
        }
        return;
      }
    } else {
      // Earlier/partial crash phases intentionally require operator reconciliation. They never
      // poll a fresh action or retry the provider mutation.
      options.report(event('failed_closed', 'uncertain'));
      while (!options.signal.aborted) {
        await waitFor(Math.max(pollIntervalMs, 5_000), options.signal);
      }
      return;
    }
  }

  options.report(event('waiting_for_assignment'));
  while (!options.signal.aborted) {
    let journal: WindowsCompanionExecutionV2CrashEvidence | undefined;
    let attemptChain: WindowsCompanionExecutionV2AttemptChain | undefined;
    let authority: SignedOneUseActionAuthority | undefined;
    let authorityTimed: TimedResponse | undefined;
    let authorityRequestStarted = false;
    let finalActionStartedAt: string | null = null;
    try {
      const pollDigest =
        digestCompanionExecutionPollContent(options.device.certificate.bodyDigest) ?? unavailable();
      const pollRequest = options.device.createSignedHttpRequest(
        COMPANION_EXECUTION_POLL_PATH,
        pollDigest,
      );
      const polled = await postTimed(
        runtime.pollEndpoint,
        { certificate: options.device.certificate, httpRequest: pollRequest },
        fetchImplementation,
        options.signal,
        monotonicNow,
      );
      if (polled.response.status === 204) {
        if (polled.response.body !== null || polled.response.headers.get('content-type') !== null) {
          unavailable();
        }
        await waitFor(pollIntervalMs, options.signal);
        continue;
      }
      if (polled.response.status !== 200 && polled.response.status !== 201) unavailable();
      const parsed = await parsedResponse(polled.response);
      if (
        !exactKeys(parsed, ['enrollment', 'assignment', 'playerId', 'authority', 'result']) ||
        parsed.authority !== null ||
        parsed.result !== null
      ) {
        options.report(event('reconciliation_pending', 'uncertain'));
        await waitFor(Math.max(pollIntervalMs, 5_000), options.signal);
        continue;
      }
      const chain =
        runtime.verifyAssignment(
          parsed.enrollment,
          parsed.assignment,
          parsed.playerId,
          polled.trustedResponseTime,
          polled.roundTrip,
        ) ?? unavailable();
      attemptChain = await persistWindowsCompanionExecutionV2InitialAttemptChain(
        chain.enrollment,
        chain.assignment,
        journalOptions,
      );
      journal =
        createWindowsCompanionExecutionV2AssignmentEvidence(
          chain.assignment,
          validDate(localNow()).toISOString(),
        ) ?? unavailable();
      await persistWindowsCompanionExecutionV2CrashEvidence(journal, journalOptions);
      options.report(event('assignment_verified'));

      let dispatchOutcome:
        | {
            readonly outcome: 'submission_attempted' | 'local_uncertain';
            readonly providerResponseDigest: string | null;
          }
        | undefined;
      try {
        dispatchOutcome = await options.session.executeExactOneUseDeposit(
          chain.playerId,
          async () => {
            options.report(event('provider_prepared'));
            const nonce = randomBytes(32);
            let requestNonceDigest: string;
            try {
              requestNonceDigest = digestCompanionExecutionNonce(nonce) ?? unavailable();
            } finally {
              nonce.fill(0);
            }
            const contentDigest =
              digestCompanionExecutionAuthorityRequestContent(
                chain.enrollment,
                chain.assignment,
                requestNonceDigest,
              ) ?? unavailable();
            const httpRequest = options.device.createSignedHttpRequest(
              COMPANION_EXECUTION_AUTHORITY_PATH,
              contentDigest,
              estimatedTrustedNow(polled, monotonicNow),
            );
            authorityRequestStarted = true;
            authorityTimed = await postTimed(
              runtime.authorityEndpoint,
              {
                certificate: options.device.certificate,
                httpRequest,
                enrollment: chain.enrollment,
                assignment: chain.assignment,
                requestNonceDigest,
              },
              fetchImplementation,
              options.signal,
              monotonicNow,
            );
            if (authorityTimed.response.status !== 200 && authorityTimed.response.status !== 201) {
              unavailable();
            }
            const authorityResponse = await parsedResponse(authorityTimed.response);
            if (!exactKeys(authorityResponse, ['authority'])) unavailable();
            const verified =
              runtime.verifyAuthority(
                authorityResponse.authority,
                chain,
                requestNonceDigest,
                authorityTimed.trustedResponseTime,
                authorityTimed.roundTrip,
              ) ?? unavailable();
            authority = verified.authority;
            attemptChain = await persistWindowsCompanionExecutionV2AttemptAuthority(
              attemptChain!,
              authority,
              journalOptions,
            );
            const receipt = await consumeWindowsCompanionExecutionV2AuthorityOnce(
              verified.verification,
              { dataRoot: options.dataRoot, now: localNow },
            );
            journal =
              recordWindowsCompanionExecutionV2FenceConsumptionEvidence(
                journal,
                authority,
                receipt,
                validDate(localNow()).toISOString(),
              ) ?? unavailable();
            await persistWindowsCompanionExecutionV2CrashEvidence(journal, journalOptions);
            options.report(event('database_fence_consumed'));
            const immediateTrustedNow = estimatedTrustedNow(authorityTimed, monotonicNow);
            if (
              !recheckOneUseActionAuthorityDeadlineAfterAtomicConsumption(verified.verification, {
                trustedNow: immediateTrustedNow.toISOString(),
                monotonicNowMs: monotonicNow(),
                atomicConsumptionReceipt: receipt,
              })
            ) {
              unavailable();
            }
            finalActionStartedAt = new Date(
              Math.max(
                immediateTrustedNow.getTime(),
                Date.parse(authority.body.databaseAuthorityIssuedAt),
              ),
            ).toISOString();
            journal =
              recordWindowsCompanionExecutionV2FinalActionStartedEvidence(
                journal,
                finalActionStartedAt,
                validDate(localNow()).toISOString(),
              ) ?? unavailable();
            await persistWindowsCompanionExecutionV2CrashEvidence(journal, journalOptions);
            options.report(event('final_action_started', 'uncertain'));
            const isFresh = () => {
              try {
                const currentMonotonic = monotonicNow();
                const currentTrusted = estimatedTrustedNow(authorityTimed!, monotonicNow);
                return (
                  currentMonotonic < verified.verification.monotonicActionDeadlineMs &&
                  currentTrusted.getTime() + COMPANION_EXECUTION_MAX_FORWARD_CLOCK_SKEW_MS <
                    Date.parse(verified.verification.signedServerActionDeadline)
                );
              } catch {
                return false;
              }
            };
            return Object.freeze({ isFresh });
          },
        );
      } catch {
        if (!journal || journal.phase === 'assignment_observed') {
          if (!authorityRequestStarted && journal?.phase === 'assignment_observed') {
            await clearWindowsCompanionExecutionV2PreFenceEvidence(journal, journalOptions);
            if (attemptChain) {
              await clearWindowsCompanionExecutionV2PreFenceAttemptChain(
                attemptChain,
                journalOptions,
              );
            }
          }
          throw new CompanionExecutionWorkerError();
        }
      }

      if (!authority || !authorityTimed || !journal) unavailable();
      let outcome: 'submission_attempted' | 'local_uncertain' | 'post_fence_no_local_action';
      let providerResponseDigest: string | null;
      if (dispatchOutcome) {
        outcome = dispatchOutcome.outcome;
        providerResponseDigest = dispatchOutcome.providerResponseDigest;
      } else if (journal.phase === 'fence_consumed_reconciliation_required') {
        outcome = 'post_fence_no_local_action';
        providerResponseDigest = null;
        finalActionStartedAt = null;
      } else {
        outcome = 'local_uncertain';
        providerResponseDigest = null;
      }
      const reportedAt = estimatedTrustedNow(authorityTimed, monotonicNow).toISOString();
      const result = runtime.createSignedResult(
        executionResultBody(
          chain,
          authority,
          outcome,
          finalActionStartedAt,
          providerResponseDigest,
          reportedAt,
        ),
        chain,
        authority,
        new Date(reportedAt),
      );
      attemptChain = await persistWindowsCompanionExecutionV2AttemptResult(
        attemptChain ?? unavailable(),
        result,
        journalOptions,
      );
      journal =
        recordWindowsCompanionExecutionV2SignedResultEvidence(
          journal,
          result,
          validDate(localNow()).toISOString(),
        ) ?? unavailable();
      await persistWindowsCompanionExecutionV2CrashEvidence(journal, journalOptions);
      options.report(
        event(
          'result_recorded',
          outcome === 'submission_attempted' ? 'submission_attempted' : 'uncertain',
        ),
      );

      const resultDigest =
        digestCompanionExecutionResultContent(
          chain.enrollment,
          chain.assignment,
          authority,
          result,
        ) ?? unavailable();
      const resultRequest = options.device.createSignedHttpRequest(
        COMPANION_EXECUTION_RESULT_PATH,
        resultDigest,
        new Date(reportedAt),
      );
      const submitted = await postTimed(
        runtime.resultEndpoint,
        {
          certificate: options.device.certificate,
          httpRequest: resultRequest,
          enrollment: chain.enrollment,
          assignment: chain.assignment,
          authority,
          result,
        },
        fetchImplementation,
        options.signal,
        monotonicNow,
      );
      if (submitted.response.status !== 200 && submitted.response.status !== 201) unavailable();
      const accepted = await parsedResponse(submitted.response);
      if (
        !exactKeys(accepted, ['accepted', 'replayed']) ||
        accepted.accepted !== true ||
        typeof accepted.replayed !== 'boolean'
      ) {
        unavailable();
      }
      options.report(
        event(
          'result_accepted',
          outcome === 'submission_attempted' ? 'submission_attempted' : 'uncertain',
        ),
      );

      const disposition = await reconcileRecordedAttempt(
        options,
        attemptChain,
        journal,
        fetchImplementation,
        monotonicNow,
        pollIntervalMs,
        journalOptions,
        submitted,
      );
      if (disposition === 'stopped') return;
    } catch {
      if (options.signal.aborted) return;
      options.report(
        event(
          authorityRequestStarted || (journal && journal.phase !== 'assignment_observed')
            ? 'failed_closed'
            : 'temporarily_unavailable',
          authorityRequestStarted || (journal && journal.phase !== 'assignment_observed')
            ? 'uncertain'
            : 'not_observed',
        ),
      );
      if (authorityRequestStarted || (journal && journal.phase !== 'assignment_observed')) {
        while (!options.signal.aborted) {
          await waitFor(Math.max(pollIntervalMs, 5_000), options.signal);
        }
        return;
      }
      await waitFor(Math.max(pollIntervalMs, 5_000), options.signal);
    }
  }
}
