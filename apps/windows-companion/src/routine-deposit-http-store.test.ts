import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import { AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE } from '@fetanagent/agent-platform-companion-contracts';
import {
  ROUTINE_DEPOSIT_CONTRACT_VERSION,
  ROUTINE_DEPOSIT_DIGEST_ALGORITHM,
  ROUTINE_DEPOSIT_PROTOCOL_MODE,
  ROUTINE_DEPOSIT_RESPONSE_TRANSCRIPT,
  ROUTINE_DEPOSIT_SIGNATURE_ALGORITHM,
  ROUTINE_DEPOSIT_SIGNATURE_ENCODING,
  canonicalRoutineDepositResponseSignatureBytes,
  decodeRoutineDepositResponseBody,
  digestRoutineDepositCommand,
  digestRoutineDepositResponseBody,
  type RoutineDepositCommand,
  type RoutineDepositResponseResult,
} from '@fetanagent/agent-platform-companion-execution-contracts';
import { describe, expect, it, vi } from 'vitest';

import type { CompanionDeviceSigningRuntime } from './device-enrollment.js';
import {
  RoutineDepositHttpStoreUnavailableError,
  createRoutineDepositHttpStore,
} from './routine-deposit-http-store.js';

const accountId = 'b7cf4f59-4d2f-4e1a-9148-0d07d2d04810';
const workerInstanceId = 'a2870310-8f08-487c-b1c0-e7dd467ad1dd';
const signerKeyId = 'routine-execution-key-0001';
const serverIssuedAt = '2026-10-05T12:00:10.000Z';

function fixture(tamperSignature = false) {
  const signer = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const signerSpki = Buffer.from(signer.publicKey.export({ format: 'der', type: 'spki' }));
  const operations: string[] = [];
  const createSignedHttpRequest = vi.fn((_path: string, _contentDigest: string) => ({
    synthetic: true,
  }));
  const device = {
    certificate: { synthetic: true },
    createSignedHttpRequest,
  } as unknown as CompanionDeviceSigningRuntime;
  const fetchImplementation = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    const parsed = JSON.parse(String(init?.body)) as { command: RoutineDepositCommand };
    const command = parsed.command;
    operations.push(command.operation);
    const result: RoutineDepositResponseResult = null;
    const body = decodeRoutineDepositResponseBody({
      contractVersion: ROUTINE_DEPOSIT_CONTRACT_VERSION,
      protocolMode: ROUTINE_DEPOSIT_PROTOCOL_MODE,
      capability: command.capability,
      requestId: command.requestId,
      operation: command.operation,
      requestContentDigest: digestRoutineDepositCommand(command),
      serverIssuedAt,
      result,
    });
    if (!body) throw new Error('Invalid test response body.');
    const transcript = canonicalRoutineDepositResponseSignatureBytes(body)!;
    const signature = sign('sha256', transcript, {
      key: signer.privateKey,
      dsaEncoding: 'ieee-p1363',
    });
    if (tamperSignature) signature[0] = signature[0]! ^ 1;
    const response = {
      contractVersion: ROUTINE_DEPOSIT_CONTRACT_VERSION,
      protocolMode: ROUTINE_DEPOSIT_PROTOCOL_MODE,
      transcriptVersion: ROUTINE_DEPOSIT_RESPONSE_TRANSCRIPT,
      bodyDigestAlgorithm: ROUTINE_DEPOSIT_DIGEST_ALGORITHM,
      bodyDigest: digestRoutineDepositResponseBody(body),
      signatureAlgorithm: ROUTINE_DEPOSIT_SIGNATURE_ALGORITHM,
      signatureEncoding: ROUTINE_DEPOSIT_SIGNATURE_ENCODING,
      signerKeyId,
      body,
      signature: signature.toString('base64url'),
    };
    return new Response(JSON.stringify({ response }), {
      status: 200,
      headers: {
        'content-type': AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
        date: 'Mon, 05 Oct 2026 12:00:10 GMT',
      },
    });
  });
  const abort = new AbortController();
  const store = createRoutineDepositHttpStore({
    device,
    expectedPlatformAgentAccountId: accountId,
    trustedExecutionSignerKeyId: signerKeyId,
    trustedExecutionSignerPublicKeySpki: signerSpki.toString('base64url'),
    trustedExecutionSignerPublicKeySpkiSha256: `sha256:${createHash('sha256')
      .update(signerSpki)
      .digest('hex')}`,
    signal: abort.signal,
    workerInstanceId,
    fetch: fetchImplementation as unknown as typeof fetch,
  });
  return { createSignedHttpRequest, fetchImplementation, operations, store };
}

describe('routine deposit HTTP store', () => {
  it('accepts authenticated null results for an idle lease and pause acknowledgement', async () => {
    const selected = fixture();

    await expect(selected.store.leaseNext()).resolves.toBeNull();
    await expect(selected.store.pause(null, 'operator_stopped')).resolves.toBeUndefined();
    expect(selected.operations).toEqual(['lease', 'pause']);
    expect(selected.fetchImplementation).toHaveBeenCalledTimes(2);
    expect(selected.createSignedHttpRequest).toHaveBeenCalledTimes(2);
    expect(selected.createSignedHttpRequest.mock.calls[0]?.[0]).toBe(
      '/v3/companion/device/routine-deposits:command',
    );
    expect(selected.createSignedHttpRequest.mock.calls[0]?.[1]).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it('fails closed without retrying when the execution signature is invalid', async () => {
    const selected = fixture(true);

    await expect(selected.store.leaseNext()).rejects.toBeInstanceOf(
      RoutineDepositHttpStoreUnavailableError,
    );
    expect(selected.fetchImplementation).toHaveBeenCalledOnce();
    expect(selected.operations).toEqual(['lease']);
  });
});
