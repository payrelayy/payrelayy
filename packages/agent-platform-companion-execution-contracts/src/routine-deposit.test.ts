import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { COMPANION_EXECUTION_CAPABILITY, COMPANION_EXECUTION_PROTOCOL_MODE } from './index.js';

import {
  ROUTINE_DEPOSIT_CAPABILITY,
  ROUTINE_DEPOSIT_CONTRACT_VERSION,
  ROUTINE_DEPOSIT_DIGEST_ALGORITHM,
  ROUTINE_DEPOSIT_PROTOCOL_MODE,
  ROUTINE_DEPOSIT_RESPONSE_TRANSCRIPT,
  ROUTINE_DEPOSIT_SIGNATURE_ALGORITHM,
  ROUTINE_DEPOSIT_SIGNATURE_ENCODING,
  canonicalRoutineDepositResponseSignatureBytes,
  decodeRoutineDepositCommand,
  decodeRoutineDepositResponseBody,
  decodeSignedRoutineDepositResponse,
  digestRoutineDepositCommand,
  digestRoutineDepositResponseBody,
  verifySignedRoutineDepositResponse,
  type RoutineDepositCommand,
  type RoutineDepositProtocolBinding,
  type RoutineDepositProtocolLease,
  type RoutineDepositResponseBody,
  type SignedRoutineDepositResponse,
} from './routine-deposit.js';

const requestId = '9f3c70c7-8a8a-4d12-9b82-2ac6d6ec41b0';
const workerInstanceId = '292d6080-f427-42ae-b1f4-6c2ee5148b66';
const accountId = 'f29fe984-6f82-47de-a75f-79f0f780cbf7';

const binding: RoutineDepositProtocolBinding = Object.freeze({
  jobId: 'a68e5ce4-7f22-4ace-bd37-230df61c204f',
  intentId: '0280badd-fcb0-497f-8b59-360d5831a570',
  attemptId: 'ea91394e-0a90-4aac-aa30-5d9828d40262',
  paymentClaimId: '37603277-1903-49a8-8869-051cbd78d68d',
  platformAgentAccountId: accountId,
  playerId: '28379330',
  amountMinor: 2_501,
  currencyCode: 'ETB',
});

const policy = Object.freeze({
  mode: 'routine_production' as const,
  status: 'active' as const,
  version: 1 as const,
  provider: 'telebirr' as const,
  platformCode: 'kemerbet' as const,
  currencyCode: 'ETB' as const,
  minimumAmountMinor: 2500 as const,
  maximumAmountMinor: 2500000 as const,
  playerScope: 'all_active_deposit_eligible' as const,
  playerOwnershipRequired: false as const,
  dailyQuotaMinor: null,
  successfulDepositQuota: null,
  maxConcurrentDeposits: 1 as const,
  amountSource: 'official_receipt_settled_amount' as const,
});

function leaseCommand(): RoutineDepositCommand {
  return Object.freeze({
    contractVersion: ROUTINE_DEPOSIT_CONTRACT_VERSION,
    protocolMode: ROUTINE_DEPOSIT_PROTOCOL_MODE,
    capability: ROUTINE_DEPOSIT_CAPABILITY,
    requestId,
    workerInstanceId,
    operation: 'lease',
    expectedPlatformAgentAccountId: accountId,
  });
}

function signedLeaseResponse(command: RoutineDepositCommand) {
  const signer = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKey = Buffer.from(signer.publicKey.export({ format: 'der', type: 'spki' }));
  const result: RoutineDepositProtocolLease = Object.freeze({
    ...binding,
    policy,
    phase: 'execute',
    paymentVerified: true,
    playerActive: true,
    playerDepositEligible: true,
    attemptNumber: 1,
    finalActionFenced: false,
  });
  const body = decodeRoutineDepositResponseBody({
    contractVersion: ROUTINE_DEPOSIT_CONTRACT_VERSION,
    protocolMode: ROUTINE_DEPOSIT_PROTOCOL_MODE,
    capability: ROUTINE_DEPOSIT_CAPABILITY,
    requestId: command.requestId,
    operation: command.operation,
    requestContentDigest: digestRoutineDepositCommand(command),
    serverIssuedAt: '2026-10-05T12:00:00.000Z',
    result,
  }) as RoutineDepositResponseBody;
  const transcript = canonicalRoutineDepositResponseSignatureBytes(body)!;
  const response: SignedRoutineDepositResponse = Object.freeze({
    contractVersion: ROUTINE_DEPOSIT_CONTRACT_VERSION,
    protocolMode: ROUTINE_DEPOSIT_PROTOCOL_MODE,
    transcriptVersion: ROUTINE_DEPOSIT_RESPONSE_TRANSCRIPT,
    bodyDigestAlgorithm: ROUTINE_DEPOSIT_DIGEST_ALGORITHM,
    bodyDigest: digestRoutineDepositResponseBody(body)!,
    signatureAlgorithm: ROUTINE_DEPOSIT_SIGNATURE_ALGORITHM,
    signatureEncoding: ROUTINE_DEPOSIT_SIGNATURE_ENCODING,
    signerKeyId: 'routine-execution-key-0001',
    body,
    signature: sign('sha256', transcript, {
      key: signer.privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url'),
  });
  return { publicKey, response };
}

describe('routine deposit protocol', () => {
  it('keeps routine amount authority variable and strictly bounded', () => {
    const commandBase = {
      contractVersion: ROUTINE_DEPOSIT_CONTRACT_VERSION,
      protocolMode: ROUTINE_DEPOSIT_PROTOCOL_MODE,
      capability: ROUTINE_DEPOSIT_CAPABILITY,
      requestId,
      workerInstanceId,
      operation: 'fence',
    } as const;

    for (const amountMinor of [2_500, 2_501, 2_500_000]) {
      expect(
        decodeRoutineDepositCommand({
          ...commandBase,
          binding: { ...binding, amountMinor },
        }),
      ).toBeDefined();
    }
    for (const amountMinor of [2_499, 2_500_001, 2_500.5]) {
      expect(
        decodeRoutineDepositCommand({
          ...commandBase,
          binding: { ...binding, amountMinor },
        }),
      ).toBeUndefined();
    }
    expect(
      decodeRoutineDepositCommand({
        ...commandBase,
        binding: { ...binding, playerId: 'p'.repeat(64) },
      }),
    ).toBeDefined();
    expect(
      decodeRoutineDepositCommand({
        ...commandBase,
        binding: { ...binding, playerId: 'p'.repeat(65) },
      }),
    ).toBeUndefined();

    expect(ROUTINE_DEPOSIT_PROTOCOL_MODE).not.toBe(COMPANION_EXECUTION_PROTOCOL_MODE);
    expect(ROUTINE_DEPOSIT_CAPABILITY).not.toBe(COMPANION_EXECUTION_CAPABILITY);
  });

  it('requires exact dispatch-credit evidence and rejects extended command objects', () => {
    const command = {
      contractVersion: ROUTINE_DEPOSIT_CONTRACT_VERSION,
      protocolMode: ROUTINE_DEPOSIT_PROTOCOL_MODE,
      capability: ROUTINE_DEPOSIT_CAPABILITY,
      requestId,
      workerInstanceId,
      operation: 'record_dispatch',
      binding,
      dispatch: {
        outcome: 'submission_attempted',
        providerResponseDigest: `sha256:${'a'.repeat(64)}`,
        exactPlayerCreditMatch: true,
      },
    } as const;
    expect(decodeRoutineDepositCommand(command)).toBeDefined();
    expect(
      decodeRoutineDepositCommand({
        ...command,
        dispatch: { ...command.dispatch, exactPlayerCreditMatch: false },
      }),
    ).toBeUndefined();
    expect(decodeRoutineDepositCommand({ ...command, retryAllowed: true })).toBeUndefined();
  });

  it('binds a fresh execution signature to the exact command and result', () => {
    const command = leaseCommand();
    const { publicKey, response } = signedLeaseResponse(command);
    const trustedNow = new Date('2026-10-05T12:00:30.000Z');

    expect(decodeSignedRoutineDepositResponse(response)).toEqual(response);
    expect(
      verifySignedRoutineDepositResponse(
        response,
        response.signerKeyId,
        publicKey,
        command,
        trustedNow,
      ),
    ).toEqual(response);
    expect(
      verifySignedRoutineDepositResponse(
        response,
        response.signerKeyId,
        publicKey,
        { ...command, requestId: 'df9270f1-f0a8-4d97-8ccc-f15cb3e94e9a' },
        trustedNow,
      ),
    ).toBeUndefined();
    expect(
      verifySignedRoutineDepositResponse(
        response,
        response.signerKeyId,
        publicKey,
        command,
        new Date('2026-10-05T12:01:00.001Z'),
      ),
    ).toBeUndefined();

    const tampered = structuredClone(response) as unknown as Record<string, unknown>;
    const tamperedBody = tampered.body as Record<string, unknown>;
    const tamperedResult = tamperedBody.result as Record<string, unknown>;
    tamperedResult.amountMinor = 2_502;
    expect(decodeSignedRoutineDepositResponse(tampered)).toBeUndefined();
    expect(publicKey).toHaveLength(91);
    publicKey.fill(0);
  });
});
