import { createHash, createPublicKey, verify } from 'node:crypto';
import { isProxy } from 'node:util/types';

export const ROUTINE_DEPOSIT_CONTRACT_VERSION = 1 as const;
export const ROUTINE_DEPOSIT_PROTOCOL_MODE =
  'windows_companion_routine_deposit_execution_v1' as const;
export const ROUTINE_DEPOSIT_CAPABILITY =
  'kemerbet.deposit.submit.verified_receipt_amount.routine.v1' as const;
export const ROUTINE_DEPOSIT_COMMAND_PATH =
  '/v3/companion/device/routine-deposits:command' as const;
export const ROUTINE_DEPOSIT_RESPONSE_TRANSCRIPT =
  'agent-platform-companion-routine-deposit-response-transcript-v1' as const;
export const ROUTINE_DEPOSIT_DIGEST_ALGORITHM = 'sha256' as const;
export const ROUTINE_DEPOSIT_SIGNATURE_ALGORITHM = 'ecdsa-p256-sha256' as const;
export const ROUTINE_DEPOSIT_SIGNATURE_ENCODING = 'ieee-p1363-base64url' as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const OPAQUE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const PLAYER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
const MINIMUM_AMOUNT_MINOR = 2_500;
const MAXIMUM_AMOUNT_MINOR = 2_500_000;

type UnknownRecord = Record<string, unknown>;

export type RoutineDepositOperation =
  'lease' | 'fence' | 'record_dispatch' | 'reconcile' | 'complete' | 'pause';

export interface RoutineDepositProtocolBinding {
  readonly jobId: string;
  readonly intentId: string;
  readonly attemptId: string;
  readonly paymentClaimId: string;
  readonly platformAgentAccountId: string;
  readonly playerId: string;
  readonly amountMinor: number;
  readonly currencyCode: 'ETB';
}

export interface RoutineDepositProtocolPolicy {
  readonly mode: 'routine_production';
  readonly status: 'active';
  readonly version: 1;
  readonly provider: 'telebirr';
  readonly platformCode: 'kemerbet';
  readonly currencyCode: 'ETB';
  readonly minimumAmountMinor: 2500;
  readonly maximumAmountMinor: 2500000;
  readonly playerScope: 'all_active_deposit_eligible';
  readonly playerOwnershipRequired: false;
  readonly dailyQuotaMinor: null;
  readonly successfulDepositQuota: null;
  readonly maxConcurrentDeposits: 1;
  readonly amountSource: 'official_receipt_settled_amount';
}

export interface RoutineDepositProtocolLease extends RoutineDepositProtocolBinding {
  readonly policy: RoutineDepositProtocolPolicy;
  readonly phase: 'execute' | 'reconcile';
  readonly paymentVerified: true;
  readonly playerActive: true;
  readonly playerDepositEligible: true;
  readonly attemptNumber: 1;
  readonly finalActionFenced: boolean;
}

export interface RoutineDepositProtocolFence extends RoutineDepositProtocolBinding {
  readonly firstFenceAcquired: true;
  readonly issuedAtMs: number;
  readonly validUntilMs: number;
}

export type RoutineDepositProtocolReconciliation =
  | { readonly outcome: 'pending' | 'uncertain' }
  | (RoutineDepositProtocolBinding & {
      readonly outcome: 'confirmed_executed';
      readonly reconciliationId: string;
      readonly evidenceDigest: string;
      readonly exactHistoryMatchCount: 1;
      readonly playerCreditConfirmed: true;
    });

export type RoutineDepositProtocolPauseReason =
  | 'invalid_policy_or_lease'
  | 'database_unavailable'
  | 'execution_uncertain'
  | 'reconciliation_uncertain'
  | 'confirmation_mismatch'
  | 'operator_stopped';

interface RoutineDepositCommandBase {
  readonly contractVersion: typeof ROUTINE_DEPOSIT_CONTRACT_VERSION;
  readonly protocolMode: typeof ROUTINE_DEPOSIT_PROTOCOL_MODE;
  readonly capability: typeof ROUTINE_DEPOSIT_CAPABILITY;
  readonly requestId: string;
  readonly workerInstanceId: string;
  readonly operation: RoutineDepositOperation;
}

export type RoutineDepositCommand =
  | (RoutineDepositCommandBase & {
      readonly operation: 'lease';
      readonly expectedPlatformAgentAccountId: string;
    })
  | (RoutineDepositCommandBase & {
      readonly operation: 'fence' | 'reconcile';
      readonly binding: RoutineDepositProtocolBinding;
    })
  | (RoutineDepositCommandBase & {
      readonly operation: 'record_dispatch';
      readonly binding: RoutineDepositProtocolBinding;
      readonly dispatch: {
        readonly outcome: 'submission_attempted';
        readonly providerResponseDigest: string;
        readonly exactPlayerCreditMatch: true;
      };
    })
  | (RoutineDepositCommandBase & {
      readonly operation: 'complete';
      readonly binding: RoutineDepositProtocolBinding;
      readonly reconciliationId: string;
    })
  | (RoutineDepositCommandBase & {
      readonly operation: 'pause';
      readonly binding: RoutineDepositProtocolBinding | null;
      readonly reason: RoutineDepositProtocolPauseReason;
    });

export type RoutineDepositResponseResult =
  | RoutineDepositProtocolLease
  | RoutineDepositProtocolFence
  | RoutineDepositProtocolBinding
  | RoutineDepositProtocolReconciliation
  | null;

export interface RoutineDepositResponseBody {
  readonly contractVersion: typeof ROUTINE_DEPOSIT_CONTRACT_VERSION;
  readonly protocolMode: typeof ROUTINE_DEPOSIT_PROTOCOL_MODE;
  readonly capability: typeof ROUTINE_DEPOSIT_CAPABILITY;
  readonly requestId: string;
  readonly operation: RoutineDepositOperation;
  readonly requestContentDigest: string;
  readonly serverIssuedAt: string;
  readonly result: RoutineDepositResponseResult;
}

export interface SignedRoutineDepositResponse {
  readonly contractVersion: typeof ROUTINE_DEPOSIT_CONTRACT_VERSION;
  readonly protocolMode: typeof ROUTINE_DEPOSIT_PROTOCOL_MODE;
  readonly transcriptVersion: typeof ROUTINE_DEPOSIT_RESPONSE_TRANSCRIPT;
  readonly bodyDigestAlgorithm: typeof ROUTINE_DEPOSIT_DIGEST_ALGORITHM;
  readonly bodyDigest: string;
  readonly signatureAlgorithm: typeof ROUTINE_DEPOSIT_SIGNATURE_ALGORITHM;
  readonly signatureEncoding: typeof ROUTINE_DEPOSIT_SIGNATURE_ENCODING;
  readonly signerKeyId: string;
  readonly body: RoutineDepositResponseBody;
  readonly signature: string;
}

function plainRecord(value: unknown): value is UnknownRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !isProxy(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === keys.length &&
    actual.every((key) => typeof key === 'string' && keys.includes(key)) &&
    keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
    })
  );
}

function safeTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function base(candidate: UnknownRecord): RoutineDepositCommandBase | undefined {
  if (
    candidate.contractVersion !== ROUTINE_DEPOSIT_CONTRACT_VERSION ||
    candidate.protocolMode !== ROUTINE_DEPOSIT_PROTOCOL_MODE ||
    candidate.capability !== ROUTINE_DEPOSIT_CAPABILITY ||
    typeof candidate.requestId !== 'string' ||
    !UUID.test(candidate.requestId) ||
    typeof candidate.workerInstanceId !== 'string' ||
    !UUID.test(candidate.workerInstanceId) ||
    (candidate.operation !== 'lease' &&
      candidate.operation !== 'fence' &&
      candidate.operation !== 'record_dispatch' &&
      candidate.operation !== 'reconcile' &&
      candidate.operation !== 'complete' &&
      candidate.operation !== 'pause')
  ) {
    return undefined;
  }
  return {
    contractVersion: ROUTINE_DEPOSIT_CONTRACT_VERSION,
    protocolMode: ROUTINE_DEPOSIT_PROTOCOL_MODE,
    capability: ROUTINE_DEPOSIT_CAPABILITY,
    requestId: candidate.requestId,
    workerInstanceId: candidate.workerInstanceId,
    operation: candidate.operation,
  };
}

export function decodeRoutineDepositBinding(
  candidate: unknown,
): RoutineDepositProtocolBinding | undefined {
  if (
    !plainRecord(candidate) ||
    !exactKeys(candidate, [
      'jobId',
      'intentId',
      'attemptId',
      'paymentClaimId',
      'platformAgentAccountId',
      'playerId',
      'amountMinor',
      'currencyCode',
    ]) ||
    typeof candidate.jobId !== 'string' ||
    !UUID.test(candidate.jobId) ||
    typeof candidate.intentId !== 'string' ||
    !UUID.test(candidate.intentId) ||
    typeof candidate.attemptId !== 'string' ||
    !UUID.test(candidate.attemptId) ||
    typeof candidate.paymentClaimId !== 'string' ||
    !UUID.test(candidate.paymentClaimId) ||
    typeof candidate.platformAgentAccountId !== 'string' ||
    !UUID.test(candidate.platformAgentAccountId) ||
    typeof candidate.playerId !== 'string' ||
    !PLAYER_ID.test(candidate.playerId) ||
    typeof candidate.amountMinor !== 'number' ||
    !Number.isSafeInteger(candidate.amountMinor) ||
    candidate.amountMinor < MINIMUM_AMOUNT_MINOR ||
    candidate.amountMinor > MAXIMUM_AMOUNT_MINOR ||
    candidate.currencyCode !== 'ETB'
  ) {
    return undefined;
  }
  return Object.freeze({
    jobId: candidate.jobId,
    intentId: candidate.intentId,
    attemptId: candidate.attemptId,
    paymentClaimId: candidate.paymentClaimId,
    platformAgentAccountId: candidate.platformAgentAccountId,
    playerId: candidate.playerId,
    amountMinor: candidate.amountMinor,
    currencyCode: 'ETB',
  });
}

function decodePolicy(candidate: unknown): RoutineDepositProtocolPolicy | undefined {
  if (
    !plainRecord(candidate) ||
    !exactKeys(candidate, [
      'mode',
      'status',
      'version',
      'provider',
      'platformCode',
      'currencyCode',
      'minimumAmountMinor',
      'maximumAmountMinor',
      'playerScope',
      'playerOwnershipRequired',
      'dailyQuotaMinor',
      'successfulDepositQuota',
      'maxConcurrentDeposits',
      'amountSource',
    ]) ||
    candidate.mode !== 'routine_production' ||
    candidate.status !== 'active' ||
    candidate.version !== 1 ||
    candidate.provider !== 'telebirr' ||
    candidate.platformCode !== 'kemerbet' ||
    candidate.currencyCode !== 'ETB' ||
    candidate.minimumAmountMinor !== MINIMUM_AMOUNT_MINOR ||
    candidate.maximumAmountMinor !== MAXIMUM_AMOUNT_MINOR ||
    candidate.playerScope !== 'all_active_deposit_eligible' ||
    candidate.playerOwnershipRequired !== false ||
    candidate.dailyQuotaMinor !== null ||
    candidate.successfulDepositQuota !== null ||
    candidate.maxConcurrentDeposits !== 1 ||
    candidate.amountSource !== 'official_receipt_settled_amount'
  ) {
    return undefined;
  }
  return Object.freeze({ ...(candidate as unknown as RoutineDepositProtocolPolicy) });
}

export function decodeRoutineDepositCommand(candidate: unknown): RoutineDepositCommand | undefined {
  if (!plainRecord(candidate)) return undefined;
  const common = base(candidate);
  if (!common) return undefined;
  if (common.operation === 'lease') {
    if (
      !exactKeys(candidate, [
        'contractVersion',
        'protocolMode',
        'capability',
        'requestId',
        'workerInstanceId',
        'operation',
        'expectedPlatformAgentAccountId',
      ]) ||
      typeof candidate.expectedPlatformAgentAccountId !== 'string' ||
      !UUID.test(candidate.expectedPlatformAgentAccountId)
    ) {
      return undefined;
    }
    return Object.freeze({
      ...common,
      operation: 'lease',
      expectedPlatformAgentAccountId: candidate.expectedPlatformAgentAccountId,
    });
  }
  const binding = decodeRoutineDepositBinding(candidate.binding);
  if (common.operation === 'pause') {
    const reasons: readonly RoutineDepositProtocolPauseReason[] = [
      'invalid_policy_or_lease',
      'database_unavailable',
      'execution_uncertain',
      'reconciliation_uncertain',
      'confirmation_mismatch',
      'operator_stopped',
    ];
    if (
      !exactKeys(candidate, [
        'contractVersion',
        'protocolMode',
        'capability',
        'requestId',
        'workerInstanceId',
        'operation',
        'binding',
        'reason',
      ]) ||
      (candidate.binding !== null && !binding) ||
      typeof candidate.reason !== 'string' ||
      !reasons.includes(candidate.reason as RoutineDepositProtocolPauseReason)
    ) {
      return undefined;
    }
    return Object.freeze({
      ...common,
      operation: 'pause',
      binding: binding ?? null,
      reason: candidate.reason as RoutineDepositProtocolPauseReason,
    });
  }
  if (!binding) return undefined;
  if (common.operation === 'fence' || common.operation === 'reconcile') {
    if (
      !exactKeys(candidate, [
        'contractVersion',
        'protocolMode',
        'capability',
        'requestId',
        'workerInstanceId',
        'operation',
        'binding',
      ])
    ) {
      return undefined;
    }
    return Object.freeze({ ...common, operation: common.operation, binding });
  }
  if (common.operation === 'record_dispatch') {
    const dispatch = candidate.dispatch;
    if (
      !exactKeys(candidate, [
        'contractVersion',
        'protocolMode',
        'capability',
        'requestId',
        'workerInstanceId',
        'operation',
        'binding',
        'dispatch',
      ]) ||
      !plainRecord(dispatch) ||
      !exactKeys(dispatch, ['outcome', 'providerResponseDigest', 'exactPlayerCreditMatch']) ||
      dispatch.outcome !== 'submission_attempted' ||
      typeof dispatch.providerResponseDigest !== 'string' ||
      !DIGEST.test(dispatch.providerResponseDigest) ||
      dispatch.exactPlayerCreditMatch !== true
    ) {
      return undefined;
    }
    return Object.freeze({
      ...common,
      operation: 'record_dispatch',
      binding,
      dispatch: Object.freeze({
        outcome: 'submission_attempted',
        providerResponseDigest: dispatch.providerResponseDigest,
        exactPlayerCreditMatch: true,
      }),
    });
  }
  if (
    !exactKeys(candidate, [
      'contractVersion',
      'protocolMode',
      'capability',
      'requestId',
      'workerInstanceId',
      'operation',
      'binding',
      'reconciliationId',
    ]) ||
    typeof candidate.reconciliationId !== 'string' ||
    !UUID.test(candidate.reconciliationId)
  ) {
    return undefined;
  }
  return Object.freeze({
    ...common,
    operation: 'complete',
    binding,
    reconciliationId: candidate.reconciliationId,
  });
}

export function digestRoutineDepositCommand(candidate: unknown): string | undefined {
  const command = decodeRoutineDepositCommand(candidate);
  return command
    ? `sha256:${createHash('sha256')
        .update('fetanagent\0routine-deposit-command\0v1\0', 'utf8')
        .update(JSON.stringify(command), 'utf8')
        .digest('hex')}`
    : undefined;
}

function decodeResult(
  operation: RoutineDepositOperation,
  candidate: unknown,
): RoutineDepositResponseResult | undefined {
  if (operation === 'pause') return candidate === null ? null : undefined;
  if (operation === 'lease' && candidate === null) return null;
  if (operation === 'reconcile') {
    if (
      plainRecord(candidate) &&
      exactKeys(candidate, ['outcome']) &&
      (candidate.outcome === 'pending' || candidate.outcome === 'uncertain')
    ) {
      return Object.freeze({ outcome: candidate.outcome });
    }
    if (
      !plainRecord(candidate) ||
      !exactKeys(candidate, [
        'jobId',
        'intentId',
        'attemptId',
        'paymentClaimId',
        'platformAgentAccountId',
        'playerId',
        'amountMinor',
        'currencyCode',
        'outcome',
        'reconciliationId',
        'evidenceDigest',
        'exactHistoryMatchCount',
        'playerCreditConfirmed',
      ])
    ) {
      return undefined;
    }
    const binding = decodeRoutineDepositBinding({
      jobId: candidate.jobId,
      intentId: candidate.intentId,
      attemptId: candidate.attemptId,
      paymentClaimId: candidate.paymentClaimId,
      platformAgentAccountId: candidate.platformAgentAccountId,
      playerId: candidate.playerId,
      amountMinor: candidate.amountMinor,
      currencyCode: candidate.currencyCode,
    });
    if (
      !binding ||
      candidate.outcome !== 'confirmed_executed' ||
      typeof candidate.reconciliationId !== 'string' ||
      !UUID.test(candidate.reconciliationId) ||
      typeof candidate.evidenceDigest !== 'string' ||
      !DIGEST.test(candidate.evidenceDigest) ||
      candidate.exactHistoryMatchCount !== 1 ||
      candidate.playerCreditConfirmed !== true
    ) {
      return undefined;
    }
    return Object.freeze({
      ...binding,
      outcome: 'confirmed_executed',
      reconciliationId: candidate.reconciliationId,
      evidenceDigest: candidate.evidenceDigest,
      exactHistoryMatchCount: 1,
      playerCreditConfirmed: true,
    });
  }
  if (operation === 'lease') {
    if (!plainRecord(candidate)) return undefined;
    const binding = decodeRoutineDepositBinding({
      jobId: candidate.jobId,
      intentId: candidate.intentId,
      attemptId: candidate.attemptId,
      paymentClaimId: candidate.paymentClaimId,
      platformAgentAccountId: candidate.platformAgentAccountId,
      playerId: candidate.playerId,
      amountMinor: candidate.amountMinor,
      currencyCode: candidate.currencyCode,
    });
    const policy = decodePolicy(candidate.policy);
    if (
      !binding ||
      !policy ||
      !exactKeys(candidate, [
        'jobId',
        'intentId',
        'attemptId',
        'paymentClaimId',
        'platformAgentAccountId',
        'playerId',
        'amountMinor',
        'currencyCode',
        'policy',
        'phase',
        'paymentVerified',
        'playerActive',
        'playerDepositEligible',
        'attemptNumber',
        'finalActionFenced',
      ]) ||
      (candidate.phase !== 'execute' && candidate.phase !== 'reconcile') ||
      candidate.paymentVerified !== true ||
      candidate.playerActive !== true ||
      candidate.playerDepositEligible !== true ||
      candidate.attemptNumber !== 1 ||
      typeof candidate.finalActionFenced !== 'boolean' ||
      (candidate.phase === 'execute' && candidate.finalActionFenced) ||
      (candidate.phase === 'reconcile' && !candidate.finalActionFenced)
    ) {
      return undefined;
    }
    return Object.freeze({
      ...binding,
      policy,
      phase: candidate.phase,
      paymentVerified: true,
      playerActive: true,
      playerDepositEligible: true,
      attemptNumber: 1,
      finalActionFenced: candidate.finalActionFenced,
    });
  }
  if (operation === 'fence') {
    if (!plainRecord(candidate)) return undefined;
    const binding = decodeRoutineDepositBinding({
      jobId: candidate.jobId,
      intentId: candidate.intentId,
      attemptId: candidate.attemptId,
      paymentClaimId: candidate.paymentClaimId,
      platformAgentAccountId: candidate.platformAgentAccountId,
      playerId: candidate.playerId,
      amountMinor: candidate.amountMinor,
      currencyCode: candidate.currencyCode,
    });
    if (
      !binding ||
      !exactKeys(candidate, [
        'jobId',
        'intentId',
        'attemptId',
        'paymentClaimId',
        'platformAgentAccountId',
        'playerId',
        'amountMinor',
        'currencyCode',
        'firstFenceAcquired',
        'issuedAtMs',
        'validUntilMs',
      ]) ||
      candidate.firstFenceAcquired !== true ||
      typeof candidate.issuedAtMs !== 'number' ||
      !Number.isSafeInteger(candidate.issuedAtMs) ||
      typeof candidate.validUntilMs !== 'number' ||
      !Number.isSafeInteger(candidate.validUntilMs) ||
      candidate.validUntilMs <= candidate.issuedAtMs ||
      candidate.validUntilMs - candidate.issuedAtMs > 10_000
    ) {
      return undefined;
    }
    return Object.freeze({
      ...binding,
      firstFenceAcquired: true,
      issuedAtMs: candidate.issuedAtMs,
      validUntilMs: candidate.validUntilMs,
    });
  }
  return decodeRoutineDepositBinding(candidate);
}

export function decodeRoutineDepositResponseBody(
  candidate: unknown,
): RoutineDepositResponseBody | undefined {
  if (
    !plainRecord(candidate) ||
    !exactKeys(candidate, [
      'contractVersion',
      'protocolMode',
      'capability',
      'requestId',
      'operation',
      'requestContentDigest',
      'serverIssuedAt',
      'result',
    ]) ||
    candidate.contractVersion !== ROUTINE_DEPOSIT_CONTRACT_VERSION ||
    candidate.protocolMode !== ROUTINE_DEPOSIT_PROTOCOL_MODE ||
    candidate.capability !== ROUTINE_DEPOSIT_CAPABILITY ||
    typeof candidate.requestId !== 'string' ||
    !UUID.test(candidate.requestId) ||
    (candidate.operation !== 'lease' &&
      candidate.operation !== 'fence' &&
      candidate.operation !== 'record_dispatch' &&
      candidate.operation !== 'reconcile' &&
      candidate.operation !== 'complete' &&
      candidate.operation !== 'pause') ||
    typeof candidate.requestContentDigest !== 'string' ||
    !DIGEST.test(candidate.requestContentDigest) ||
    !safeTimestamp(candidate.serverIssuedAt)
  ) {
    return undefined;
  }
  const result = decodeResult(candidate.operation, candidate.result);
  if (result === undefined) return undefined;
  return Object.freeze({
    contractVersion: ROUTINE_DEPOSIT_CONTRACT_VERSION,
    protocolMode: ROUTINE_DEPOSIT_PROTOCOL_MODE,
    capability: ROUTINE_DEPOSIT_CAPABILITY,
    requestId: candidate.requestId,
    operation: candidate.operation,
    requestContentDigest: candidate.requestContentDigest,
    serverIssuedAt: candidate.serverIssuedAt,
    result,
  });
}

export function digestRoutineDepositResponseBody(candidate: unknown): string | undefined {
  const body = decodeRoutineDepositResponseBody(candidate);
  return body
    ? `sha256:${createHash('sha256')
        .update('fetanagent\0routine-deposit-response-body\0v1\0', 'utf8')
        .update(JSON.stringify(body), 'utf8')
        .digest('hex')}`
    : undefined;
}

export function canonicalRoutineDepositResponseSignatureBytes(
  candidate: unknown,
): Buffer | undefined {
  const body = decodeRoutineDepositResponseBody(candidate);
  return body
    ? Buffer.from(
        `fetanagent\0${ROUTINE_DEPOSIT_RESPONSE_TRANSCRIPT}\0${JSON.stringify(body)}`,
        'utf8',
      )
    : undefined;
}

export function decodeSignedRoutineDepositResponse(
  candidate: unknown,
): SignedRoutineDepositResponse | undefined {
  if (
    !plainRecord(candidate) ||
    !exactKeys(candidate, [
      'contractVersion',
      'protocolMode',
      'transcriptVersion',
      'bodyDigestAlgorithm',
      'bodyDigest',
      'signatureAlgorithm',
      'signatureEncoding',
      'signerKeyId',
      'body',
      'signature',
    ]) ||
    candidate.contractVersion !== ROUTINE_DEPOSIT_CONTRACT_VERSION ||
    candidate.protocolMode !== ROUTINE_DEPOSIT_PROTOCOL_MODE ||
    candidate.transcriptVersion !== ROUTINE_DEPOSIT_RESPONSE_TRANSCRIPT ||
    candidate.bodyDigestAlgorithm !== ROUTINE_DEPOSIT_DIGEST_ALGORITHM ||
    typeof candidate.bodyDigest !== 'string' ||
    !DIGEST.test(candidate.bodyDigest) ||
    candidate.signatureAlgorithm !== ROUTINE_DEPOSIT_SIGNATURE_ALGORITHM ||
    candidate.signatureEncoding !== ROUTINE_DEPOSIT_SIGNATURE_ENCODING ||
    typeof candidate.signerKeyId !== 'string' ||
    !OPAQUE.test(candidate.signerKeyId) ||
    typeof candidate.signature !== 'string' ||
    !SIGNATURE.test(candidate.signature)
  ) {
    return undefined;
  }
  const body = decodeRoutineDepositResponseBody(candidate.body);
  if (!body || digestRoutineDepositResponseBody(body) !== candidate.bodyDigest) return undefined;
  return Object.freeze({
    contractVersion: ROUTINE_DEPOSIT_CONTRACT_VERSION,
    protocolMode: ROUTINE_DEPOSIT_PROTOCOL_MODE,
    transcriptVersion: ROUTINE_DEPOSIT_RESPONSE_TRANSCRIPT,
    bodyDigestAlgorithm: ROUTINE_DEPOSIT_DIGEST_ALGORITHM,
    bodyDigest: candidate.bodyDigest,
    signatureAlgorithm: ROUTINE_DEPOSIT_SIGNATURE_ALGORITHM,
    signatureEncoding: ROUTINE_DEPOSIT_SIGNATURE_ENCODING,
    signerKeyId: candidate.signerKeyId,
    body,
    signature: candidate.signature,
  });
}

export function verifySignedRoutineDepositResponse(
  candidate: unknown,
  trustedSignerKeyId: string,
  trustedSignerPublicKeySpkiDer: Uint8Array,
  commandCandidate: unknown,
  trustedNow: Date,
): SignedRoutineDepositResponse | undefined {
  const command = decodeRoutineDepositCommand(commandCandidate);
  const response = decodeSignedRoutineDepositResponse(candidate);
  const commandDigest = digestRoutineDepositCommand(command);
  if (
    !command ||
    !response ||
    !commandDigest ||
    response.signerKeyId !== trustedSignerKeyId ||
    response.body.requestId !== command.requestId ||
    response.body.operation !== command.operation ||
    response.body.requestContentDigest !== commandDigest ||
    !Number.isFinite(trustedNow.getTime()) ||
    Math.abs(trustedNow.getTime() - Date.parse(response.body.serverIssuedAt)) > 60_000
  ) {
    return undefined;
  }
  const transcript = canonicalRoutineDepositResponseSignatureBytes(response.body);
  if (!transcript) return undefined;
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(trustedSignerPublicKeySpkiDer),
      format: 'der',
      type: 'spki',
    });
    const signature = Buffer.from(response.signature, 'base64url');
    return signature.byteLength === 64 &&
      verify('sha256', transcript, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature)
      ? response
      : undefined;
  } catch {
    return undefined;
  }
}
