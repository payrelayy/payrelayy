import { createHash, randomUUID } from 'node:crypto';
import { isProxy } from 'node:util/types';

import { AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE } from '@fetanagent/agent-platform-companion-contracts';
import {
  ROUTINE_DEPOSIT_CAPABILITY,
  ROUTINE_DEPOSIT_COMMAND_PATH,
  ROUTINE_DEPOSIT_CONTRACT_VERSION,
  ROUTINE_DEPOSIT_PROTOCOL_MODE,
  decodeRoutineDepositBinding,
  digestRoutineDepositCommand,
  verifySignedRoutineDepositResponse,
  type RoutineDepositCommand,
  type RoutineDepositProtocolBinding,
  type RoutineDepositProtocolFence,
  type RoutineDepositProtocolLease,
  type RoutineDepositProtocolReconciliation,
  type RoutineDepositResponseResult,
} from '@fetanagent/agent-platform-companion-execution-contracts';

import type { CompanionDeviceSigningRuntime } from './device-enrollment.js';
import type { LocalKemerBetDepositDispatchOutcome } from './provider-route.js';
import type { RoutineHistoryObservation } from './routine-kemerbet-history.js';
import type {
  RoutineDepositBinding,
  RoutineDepositExecutionStore,
  RoutineDepositFence,
  RoutineDepositLease,
  RoutineDepositPauseReason,
  RoutineDepositReconciliation,
} from './routine-deposit-worker.js';

const RESPONSE_LIMIT_BYTES = 128 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const ROUTINE_ENDPOINT = `https://device.fetanagent.com${ROUTINE_DEPOSIT_COMMAND_PATH}`;

type UnknownRecord = Record<string, unknown>;

export interface RoutineDepositHttpStoreOptions {
  readonly device: CompanionDeviceSigningRuntime;
  readonly expectedPlatformAgentAccountId: string;
  readonly trustedExecutionSignerKeyId: string;
  readonly trustedExecutionSignerPublicKeySpki: string;
  readonly trustedExecutionSignerPublicKeySpkiSha256: string;
  readonly signal: AbortSignal;
  readonly workerInstanceId?: string;
  readonly fetch?: typeof fetch;
  readonly reportDiagnostic?: (event: RoutineDepositHttpStoreDiagnostic) => void;
}

export interface RoutineDepositHttpStoreDiagnostic {
  readonly operation:
    'lease' | 'fence' | 'record_dispatch' | 'reconcile' | 'confirm_history' | 'complete';
  readonly stage:
    | 'request_aborted'
    | 'request_build_failed'
    | 'transport_timeout'
    | 'transport_failed'
    | 'http_rejected'
    | 'response_contract_invalid'
    | 'response_read_failed'
    | 'response_signature_invalid'
    | 'binding_mismatch'
    | 'same_signed_request_retry'
    | 'signed_response_verified';
  readonly httpStatus?: number;
}

export class RoutineDepositHttpStoreUnavailableError extends Error {
  constructor() {
    super('The authenticated routine-deposit broker is unavailable.');
    this.name = 'RoutineDepositHttpStoreUnavailableError';
  }
}

function unavailable(): never {
  throw new RoutineDepositHttpStoreUnavailableError();
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

async function responseBytes(response: Response): Promise<Buffer> {
  const declared = response.headers.get('content-length');
  if (
    declared !== null &&
    (!/^[1-9][0-9]{0,6}$/u.test(declared) || Number(declared) > RESPONSE_LIMIT_BYTES)
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
      if (total > RESPONSE_LIMIT_BYTES) {
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

function binding(candidate: RoutineDepositBinding): RoutineDepositProtocolBinding {
  // A signed lease also carries policy and execution state; the wire binding accepts only these eight fields.
  return (
    decodeRoutineDepositBinding({
      jobId: candidate.jobId,
      intentId: candidate.intentId,
      attemptId: candidate.attemptId,
      paymentClaimId: candidate.paymentClaimId,
      platformAgentAccountId: candidate.platformAgentAccountId,
      playerId: candidate.playerId,
      amountMinor: candidate.amountMinor,
      currencyCode: candidate.currencyCode,
    }) ?? unavailable()
  );
}

function sameBinding(
  expected: RoutineDepositProtocolBinding,
  candidate: unknown,
): candidate is RoutineDepositProtocolBinding {
  const actual = decodeRoutineDepositBinding(candidate);
  return (
    actual !== undefined &&
    actual.jobId === expected.jobId &&
    actual.intentId === expected.intentId &&
    actual.attemptId === expected.attemptId &&
    actual.paymentClaimId === expected.paymentClaimId &&
    actual.platformAgentAccountId === expected.platformAgentAccountId &&
    actual.playerId === expected.playerId &&
    actual.amountMinor === expected.amountMinor &&
    actual.currencyCode === expected.currencyCode
  );
}

function base(
  requestId: string,
  workerInstanceId: string,
  operation: RoutineDepositCommand['operation'],
) {
  return {
    contractVersion: ROUTINE_DEPOSIT_CONTRACT_VERSION,
    protocolMode: ROUTINE_DEPOSIT_PROTOCOL_MODE,
    capability: ROUTINE_DEPOSIT_CAPABILITY,
    requestId,
    workerInstanceId,
    operation,
  } as const;
}

/**
 * Authenticated network implementation of the routine worker port. It never retries a fence or
 * provider action. One bounded replay of an identical signed lease or post-action broker request
 * can recover a response lost after the broker committed its one-use ledger row.
 */
export function createRoutineDepositHttpStore(
  options: RoutineDepositHttpStoreOptions,
): RoutineDepositExecutionStore {
  const workerInstanceId = options.workerInstanceId ?? randomUUID();
  if (
    !UUID.test(workerInstanceId) ||
    !UUID.test(options.expectedPlatformAgentAccountId) ||
    !KEY_ID.test(options.trustedExecutionSignerKeyId) ||
    !DIGEST.test(options.trustedExecutionSignerPublicKeySpkiSha256)
  ) {
    return unavailable();
  }
  const signerPublicKey = Buffer.from(options.trustedExecutionSignerPublicKeySpki, 'base64url');
  if (
    signerPublicKey.byteLength !== 91 ||
    signerPublicKey.toString('base64url') !== options.trustedExecutionSignerPublicKeySpki ||
    `sha256:${createHash('sha256').update(signerPublicKey).digest('hex')}` !==
      options.trustedExecutionSignerPublicKeySpkiSha256
  ) {
    signerPublicKey.fill(0);
    return unavailable();
  }
  const fetchImplementation = options.fetch ?? fetch;

  function reportDiagnostic(
    operation: RoutineDepositCommand['operation'],
    stage: RoutineDepositHttpStoreDiagnostic['stage'],
    httpStatus?: number,
  ): void {
    // Idle leases emit no diagnostic. Report only failures and an actual signed retry so a
    // committed lease lost in transit is distinguishable from an empty queue.
    if (operation === 'pause') return;
    try {
      options.reportDiagnostic?.(
        Object.freeze({
          operation,
          stage,
          ...(httpStatus === undefined ? {} : { httpStatus }),
        }),
      );
    } catch {
      // Diagnostics must never change the fail-closed command outcome.
    }
  }

  async function command(value: RoutineDepositCommand): Promise<RoutineDepositResponseResult> {
    if (options.signal.aborted) {
      reportDiagnostic(value.operation, 'request_aborted');
      return unavailable();
    }
    let httpRequest: ReturnType<CompanionDeviceSigningRuntime['createSignedHttpRequest']>;
    try {
      const contentDigest = digestRoutineDepositCommand(value) ?? unavailable();
      httpRequest = options.device.createSignedHttpRequest(
        ROUTINE_DEPOSIT_COMMAND_PATH,
        contentDigest,
      );
    } catch {
      reportDiagnostic(value.operation, 'request_build_failed');
      return unavailable();
    }
    // Never create a new command or device signature during recovery. The server's immutable
    // replay ledger accepts this exact envelope once, including when the first reply was lost.
    let requestBody: string;
    try {
      requestBody = JSON.stringify({
        certificate: options.device.certificate,
        httpRequest,
        command: value,
      });
    } catch {
      reportDiagnostic(value.operation, 'request_build_failed');
      return unavailable();
    }
    const replayable =
      value.operation === 'lease' ||
      value.operation === 'record_dispatch' ||
      value.operation === 'reconcile' ||
      value.operation === 'confirm_history' ||
      value.operation === 'complete' ||
      value.operation === 'pause';
    for (let attempt = 1; attempt <= (replayable ? 2 : 1); attempt += 1) {
      if (options.signal.aborted) {
        reportDiagnostic(value.operation, 'request_aborted');
        return unavailable();
      }
      const timeoutSignal = AbortSignal.timeout(15_000);
      let response: Response;
      try {
        response = await fetchImplementation(ROUTINE_ENDPOINT, {
          method: 'POST',
          redirect: 'error',
          cache: 'no-store',
          headers: {
            accept: AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
            'content-type': AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
          },
          body: requestBody,
          signal: AbortSignal.any([options.signal, timeoutSignal]),
        });
      } catch {
        reportDiagnostic(
          value.operation,
          options.signal.aborted
            ? 'request_aborted'
            : timeoutSignal.aborted
              ? 'transport_timeout'
              : 'transport_failed',
        );
        if (replayable && attempt === 1 && !options.signal.aborted) {
          reportDiagnostic(value.operation, 'same_signed_request_retry');
          continue;
        }
        return unavailable();
      }
      if (response.status !== 200 && response.status !== 201) {
        reportDiagnostic(value.operation, 'http_rejected', response.status);
        if (replayable && attempt === 1 && response.status >= 500 && !options.signal.aborted) {
          await response.body?.cancel().catch(() => undefined);
          reportDiagnostic(value.operation, 'same_signed_request_retry');
          continue;
        }
        return unavailable();
      }
      if (response.headers.get('content-type') !== AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE) {
        reportDiagnostic(value.operation, 'response_contract_invalid');
        return unavailable();
      }
      const serverDate = response.headers.get('date');
      const trustedNow = serverDate === null ? new Date(Number.NaN) : new Date(serverDate);
      let bytes: Buffer;
      try {
        bytes = await responseBytes(response);
      } catch {
        reportDiagnostic(
          value.operation,
          options.signal.aborted
            ? 'request_aborted'
            : timeoutSignal.aborted
              ? 'transport_timeout'
              : 'response_read_failed',
        );
        if (replayable && attempt === 1 && !options.signal.aborted) {
          await response.body?.cancel().catch(() => undefined);
          reportDiagnostic(value.operation, 'same_signed_request_retry');
          continue;
        }
        return unavailable();
      }
      try {
        const parsed: unknown = JSON.parse(bytes.toString('utf8'));
        if (!plainRecord(parsed) || !exactKeys(parsed, ['response'])) {
          reportDiagnostic(value.operation, 'response_contract_invalid');
          return unavailable();
        }
        const verified = verifySignedRoutineDepositResponse(
          parsed.response,
          options.trustedExecutionSignerKeyId,
          signerPublicKey,
          value,
          trustedNow,
        );
        if (!verified) {
          reportDiagnostic(value.operation, 'response_signature_invalid');
          return unavailable();
        }
        if (value.operation === 'fence' || attempt > 1) {
          reportDiagnostic(value.operation, 'signed_response_verified');
        }
        return verified.body.result;
      } catch (error) {
        if (error instanceof RoutineDepositHttpStoreUnavailableError) throw error;
        reportDiagnostic(value.operation, 'response_contract_invalid');
        return unavailable();
      } finally {
        bytes.fill(0);
      }
    }
    return unavailable();
  }

  return Object.freeze({
    async leaseNext(): Promise<RoutineDepositLease | null> {
      const request: RoutineDepositCommand = Object.freeze({
        ...base(randomUUID(), workerInstanceId, 'lease'),
        operation: 'lease',
        expectedPlatformAgentAccountId: options.expectedPlatformAgentAccountId,
      });
      const result = await command(request);
      if (result === null) return null;
      const lease = result as RoutineDepositProtocolLease;
      if (lease.platformAgentAccountId !== options.expectedPlatformAgentAccountId) {
        return unavailable();
      }
      return lease as RoutineDepositLease;
    },
    async fenceFinalAction(lease: RoutineDepositLease): Promise<RoutineDepositFence> {
      const request: RoutineDepositCommand = Object.freeze({
        ...base(randomUUID(), workerInstanceId, 'fence'),
        operation: 'fence',
        binding: binding(lease),
      });
      return (await command(request)) as RoutineDepositProtocolFence as RoutineDepositFence;
    },
    async recordDispatch(
      lease: RoutineDepositLease,
      outcome: LocalKemerBetDepositDispatchOutcome,
    ): Promise<void> {
      if (
        outcome.outcome !== 'submission_attempted' ||
        outcome.exactPlayerCreditMatch !== true ||
        !DIGEST.test(outcome.providerResponseDigest)
      ) {
        return unavailable();
      }
      const expectedBinding = binding(lease);
      const request: RoutineDepositCommand = Object.freeze({
        ...base(randomUUID(), workerInstanceId, 'record_dispatch'),
        operation: 'record_dispatch',
        binding: expectedBinding,
        dispatch: Object.freeze({
          outcome: 'submission_attempted',
          providerResponseDigest: outcome.providerResponseDigest,
          exactPlayerCreditMatch: true,
        }),
      });
      const result = await command(request);
      if (!sameBinding(expectedBinding, result)) {
        reportDiagnostic('record_dispatch', 'binding_mismatch');
        return unavailable();
      }
    },
    async reconcile(lease: RoutineDepositLease): Promise<RoutineDepositReconciliation> {
      const request: RoutineDepositCommand = Object.freeze({
        ...base(randomUUID(), workerInstanceId, 'reconcile'),
        operation: 'reconcile',
        binding: binding(lease),
      });
      return (await command(
        request,
      )) as RoutineDepositProtocolReconciliation as RoutineDepositReconciliation;
    },
    async confirmHistory(
      lease: RoutineDepositLease,
      observation: RoutineHistoryObservation,
    ): Promise<RoutineDepositReconciliation> {
      const request: RoutineDepositCommand = Object.freeze({
        ...base(randomUUID(), workerInstanceId, 'confirm_history'),
        operation: 'confirm_history',
        binding: binding(lease),
        observation,
      });
      return (await command(
        request,
      )) as RoutineDepositProtocolReconciliation as RoutineDepositReconciliation;
    },
    async completeConfirmed(
      lease: RoutineDepositLease,
      reconciliationId: string,
    ): Promise<RoutineDepositBinding> {
      const request: RoutineDepositCommand = Object.freeze({
        ...base(randomUUID(), workerInstanceId, 'complete'),
        operation: 'complete',
        binding: binding(lease),
        reconciliationId,
      });
      const result = await command(request);
      return decodeRoutineDepositBinding(result) ?? unavailable();
    },
    async pause(
      lease: RoutineDepositLease | null,
      reason: RoutineDepositPauseReason,
    ): Promise<void> {
      const request: RoutineDepositCommand = Object.freeze({
        ...base(randomUUID(), workerInstanceId, 'pause'),
        operation: 'pause',
        binding: lease === null ? null : binding(lease),
        reason,
      });
      if ((await command(request)) !== null) return unavailable();
    },
  });
}
