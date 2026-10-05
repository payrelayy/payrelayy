import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import {
  AGENT_PLATFORM_COMPANION_CERTIFICATE_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
  AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
  AGENT_PLATFORM_COMPANION_HTTP_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
  canonicalCompanionEnrollmentCertificateSignatureBytes,
  canonicalCompanionHttpRequestSignatureBytes,
  digestCompanionEnrollmentCertificateBody,
  digestCompanionHttpRequestBody,
  digestCompanionLookupEmptyQuery,
  type CompanionEnrollmentCertificateBody,
  type CompanionHttpRequestBody,
  type CompanionNoMoneySafety,
  type SignedCompanionEnrollmentCertificate,
  type SignedCompanionHttpRequest,
} from '@fetanagent/agent-platform-companion-contracts';
import {
  ROUTINE_DEPOSIT_CAPABILITY,
  ROUTINE_DEPOSIT_COMMAND_PATH,
  ROUTINE_DEPOSIT_CONTRACT_VERSION,
  ROUTINE_DEPOSIT_PROTOCOL_MODE,
  digestRoutineDepositCommand,
  verifySignedRoutineDepositResponse,
  type RoutineDepositCommand,
} from '@fetanagent/agent-platform-companion-execution-contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  createDormantRoutineDepositHandler,
  createRoutineDepositHandler,
  type RoutineDepositHandlerDependencies,
} from './routine-deposit-handler.js';
import {
  createP256CompanionBridgeSigner,
  type CompanionBridgeHttpRequest,
} from './pairing-handler.js';

const assessedAt = '2026-10-05T12:00:10.000Z';
const noMoneyKeyId = 'companion-no-money-key-0001';
const executionKeyId = 'routine-execution-key-0001';
const sha = (character: string): string => `sha256:${character.repeat(64)}`;

const noMoneySafety: CompanionNoMoneySafety = Object.freeze({
  accountMutationAllowed: false,
  balanceMutationAllowed: false,
  providerMutationAllowed: false,
  paymentAllowed: false,
  depositAllowed: false,
  withdrawAllowed: false,
  transferAllowed: false,
  settlementAllowed: false,
  finalActionAllowed: false,
  financialActionAllowed: false,
  moneyMovementAllowed: false,
  transferDisabled: true,
  identifiersRedacted: true,
  moneyMoved: false,
});

function p1363(privateKey: KeyObject, transcript: Uint8Array): string {
  return sign('sha256', transcript, {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
}

function fixture() {
  const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const noMoney = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const execution = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const deviceSpki = Buffer.from(device.publicKey.export({ format: 'der', type: 'spki' }));
  const noMoneySpki = Buffer.from(noMoney.publicKey.export({ format: 'der', type: 'spki' }));
  const executionSpki = Buffer.from(execution.publicKey.export({ format: 'der', type: 'spki' }));
  const certificateBody: CompanionEnrollmentCertificateBody = Object.freeze({
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    certificateId: 'device-certificate-0001',
    pairingId: 'pairing-request-0001',
    pairingRequestBodyDigest: sha('1'),
    pairingNonceDigest: sha('2'),
    pairingConsumed: true,
    deviceId: 'windows-device-0001',
    deviceKeyId: 'windows-device-key-0001',
    devicePublicKeySpki: deviceSpki.toString('base64url'),
    devicePublicKeySpkiSha256: `sha256:${createHash('sha256').update(deviceSpki).digest('hex')}`,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    devicePlatform: 'windows',
    companionVersion: '0.1.5',
    state: 'active',
    issuedAt: '2026-10-05T11:59:00.000Z',
    validFrom: '2026-10-05T11:59:00.000Z',
    validUntil: '2027-01-03T11:59:00.000Z',
    ...noMoneySafety,
  });
  const certificate: SignedCompanionEnrollmentCertificate = Object.freeze({
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    transcriptVersion: AGENT_PLATFORM_COMPANION_CERTIFICATE_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
    bodyDigest: digestCompanionEnrollmentCertificateBody(certificateBody)!,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
    signerKeyId: noMoneyKeyId,
    body: certificateBody,
    signature: p1363(
      noMoney.privateKey,
      canonicalCompanionEnrollmentCertificateSignatureBytes(certificateBody, noMoneyKeyId)!,
    ),
  });
  const command: RoutineDepositCommand = Object.freeze({
    contractVersion: ROUTINE_DEPOSIT_CONTRACT_VERSION,
    protocolMode: ROUTINE_DEPOSIT_PROTOCOL_MODE,
    capability: ROUTINE_DEPOSIT_CAPABILITY,
    requestId: '80a3ca82-82bd-4979-bd4e-b47ece879bda',
    workerInstanceId: '55bcaadd-c4a8-4502-8956-7abc60a3dd48',
    operation: 'lease',
    expectedPlatformAgentAccountId: '2f12c23c-4a09-45fe-b685-4fa08f6c55f1',
  });

  function httpRequest(
    contentDigest = digestRoutineDepositCommand(command)!,
  ): SignedCompanionHttpRequest {
    const body: CompanionHttpRequestBody = Object.freeze({
      contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
      protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
      requestId: 'routine-http-request-0001',
      certificateId: certificate.body.certificateId,
      deviceId: certificate.body.deviceId,
      deviceKeyId: certificate.body.deviceKeyId,
      method: 'POST',
      canonicalPath: ROUTINE_DEPOSIT_COMMAND_PATH,
      queryDigest: digestCompanionLookupEmptyQuery(),
      contentDigest,
      nonceDigest: sha('3'),
      issuedAt: '2026-10-05T12:00:05.000Z',
      expiresAt: '2026-10-05T12:00:35.000Z',
      ...noMoneySafety,
    });
    return Object.freeze({
      contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
      protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
      transcriptVersion: AGENT_PLATFORM_COMPANION_HTTP_TRANSCRIPT_VERSION,
      bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
      bodyDigest: digestCompanionHttpRequestBody(body)!,
      signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
      signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
      deviceKeyId: body.deviceKeyId,
      body,
      signature: p1363(device.privateKey, canonicalCompanionHttpRequestSignatureBytes(body)!),
    });
  }

  function request(
    selectedCommand: unknown = command,
    selectedHttpRequest: SignedCompanionHttpRequest = httpRequest(),
  ): CompanionBridgeHttpRequest {
    return Object.freeze({
      method: 'POST',
      path: ROUTINE_DEPOSIT_COMMAND_PATH,
      headers: Object.freeze([
        ['content-type', AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE] as const,
        ['accept', AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE] as const,
      ]),
      body: Buffer.from(
        JSON.stringify({ certificate, httpRequest: selectedHttpRequest, command: selectedCommand }),
        'utf8',
      ),
    });
  }

  return {
    certificate,
    command,
    executionSpki,
    httpRequest,
    noMoneySigner: createP256CompanionBridgeSigner(noMoneyKeyId, noMoney.privateKey, noMoneySpki),
    executionSigner: createP256CompanionBridgeSigner(
      executionKeyId,
      execution.privateKey,
      executionSpki,
    ),
    request,
  };
}

describe('routine deposit handler', () => {
  it('authenticates the paired device and returns a distinctly execution-signed response', async () => {
    const selected = fixture();
    const executeCommand = vi.fn<RoutineDepositHandlerDependencies['executeCommand']>(
      async () => null,
    );
    const handler = createRoutineDepositHandler({
      noMoneySigner: selected.noMoneySigner,
      executionSigner: selected.executionSigner,
      now: () => new Date(assessedAt),
      executeCommand,
    });

    const response = await handler(selected.request());
    expect(response.statusCode).toBe(200);
    const parsed = JSON.parse(Buffer.from(response.body).toString('utf8')) as {
      response: unknown;
    };
    expect(
      verifySignedRoutineDepositResponse(
        parsed.response,
        executionKeyId,
        selected.executionSpki,
        selected.command,
        new Date(assessedAt),
      )?.body.result,
    ).toBeNull();
    expect(executeCommand).toHaveBeenCalledOnce();
    expect(executeCommand.mock.calls[0]?.[0]).toEqual(selected.certificate);
    expect(executeCommand.mock.calls[0]?.[2]).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(executeCommand.mock.calls[0]?.[3]).toEqual(selected.command);
    expect(executeCommand.mock.calls[0]?.[4]).toBe(assessedAt);
  });

  it('rejects a command whose authenticated content digest does not match', async () => {
    const selected = fixture();
    const executeCommand = vi.fn<RoutineDepositHandlerDependencies['executeCommand']>(
      async () => null,
    );
    const handler = createRoutineDepositHandler({
      noMoneySigner: selected.noMoneySigner,
      executionSigner: selected.executionSigner,
      now: () => new Date(assessedAt),
      executeCommand,
    });
    const altered = { ...selected.command, expectedPlatformAgentAccountId: crypto.randomUUID() };

    const response = await handler(selected.request(altered));
    expect(response.statusCode).toBe(401);
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('keeps an unconfigured routine route dormant', async () => {
    const selected = fixture();
    const response = await createDormantRoutineDepositHandler()(selected.request());
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(Buffer.from(response.body).toString('utf8'))).toEqual({
      code: 'temporarily_unavailable',
    });
  });
});
