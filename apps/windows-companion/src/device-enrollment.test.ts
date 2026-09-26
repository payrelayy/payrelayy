import { createHash, generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AGENT_PLATFORM_COMPANION_CERTIFICATE_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_ASSIGNMENT_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
  AGENT_PLATFORM_COMPANION_DEVICE_PLATFORM,
  AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
  AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
  canonicalCompanionEnrollmentCertificateSignatureBytes,
  canonicalKemerBetExactFiveLookupAssignmentSignatureBytes,
  digestCompanionEnrollmentCertificateBody,
  digestKemerBetExactFiveLookupAssignmentBody,
  verifySignedCompanionPairingRequest,
  type CompanionEnrollmentCertificateBody,
  type CompanionNoMoneySafety,
  type KemerBetExactFiveLookupAssignmentBody,
  type SignedCompanionEnrollmentCertificate,
  type SignedCompanionPairingRequest,
  type SignedKemerBetExactFiveLookupAssignment,
} from '@fetanagent/agent-platform-companion-contracts';
import {
  COMPANION_EXECUTION_ACTION_KIND,
  COMPANION_EXECUTION_AMOUNT_MINOR_UNITS,
  COMPANION_EXECUTION_CAPABILITY,
  COMPANION_EXECUTION_CONTRACT_VERSION,
  COMPANION_EXECUTION_CURRENCY_CODE,
  COMPANION_EXECUTION_PLATFORM_CODE,
  COMPANION_EXECUTION_POLL_PATH,
  COMPANION_EXECUTION_PROTOCOL_MODE,
  digestCompanionExecutionNonce,
  digestCompanionExecutionPlayerId,
  signAuthoritativeExecutionStatus,
  signExecutionAssignment,
  signExecutionEnrollment,
  signOneUseActionAuthority,
  type AuthoritativeExecutionStatusBody,
  type ExecutionAssignmentBody,
  type ExecutionEnrollmentBody,
  type ExecutionResultBody,
  type OneUseActionAuthorityBody,
} from '@fetanagent/agent-platform-companion-execution-contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  COMPANION_PAIRING_CONTENT_TYPE,
  COMPANION_PAIRING_PACKAGE_PREFIX,
  COMPANION_PAIRING_PATH,
  WINDOWS_COMPANION_VERSION,
  decodeCompanionPairingPackage,
  ensureCompanionDeviceEnrollment,
  loadCompanionDeviceSigningRuntime,
  restoreCompanionDeviceEnrollment,
} from './device-enrollment.js';
import { verifyCompanionLaunchProof } from './launch-proof.js';
import type { WindowsCurrentUserDataProtector } from './windows-data-protection.js';

const roots: string[] = [];
const now = new Date('2026-09-04T12:00:00.000Z');
const releaseSha = 'a'.repeat(40);
const signerKeyId = 'companion-server-staging-v1';

const safety: CompanionNoMoneySafety = Object.freeze({
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

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function sha(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'fetanagent-companion-enrollment-'));
  roots.push(value);
  return value;
}

function protector(): WindowsCurrentUserDataProtector {
  const prefix = Buffer.from('test-dpapi-device-key:', 'utf8');
  return Object.freeze({
    protect: async (cleartext: Buffer) => Buffer.concat([prefix, cleartext]),
    unprotect: async (ciphertext: Buffer) => {
      if (!ciphertext.subarray(0, prefix.length).equals(prefix)) throw new Error();
      return Buffer.from(ciphertext.subarray(prefix.length));
    },
  });
}

function pairingPackage(serverPublicKey: Buffer, overrides: Record<string, unknown> = {}): string {
  const payload = {
    schemaVersion: 1,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    pairingId: '11111111-1111-4111-8111-111111111111',
    pairingNonceDigest: `sha256:${'b'.repeat(64)}`,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1_000).toISOString(),
    endpoint: `https://device.fetanagent.com${COMPANION_PAIRING_PATH}`,
    signerKeyId,
    serverSigningPublicKeySpki: serverPublicKey.toString('base64url'),
    serverSigningPublicKeySpkiSha256: sha(serverPublicKey),
    minimumCompanionVersion: WINDOWS_COMPANION_VERSION,
    oneUse: true,
    ...safety,
    ...overrides,
  };
  return `${COMPANION_PAIRING_PACKAGE_PREFIX}${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`;
}

function certificateBody(
  request: SignedCompanionPairingRequest,
): CompanionEnrollmentCertificateBody {
  return Object.freeze({
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    certificateId: randomUUID(),
    pairingId: request.body.pairingId,
    pairingRequestBodyDigest: request.bodyDigest,
    pairingNonceDigest: request.body.pairingNonceDigest,
    pairingConsumed: true,
    deviceId: request.body.deviceId,
    deviceKeyId: request.body.deviceKeyId,
    devicePublicKeySpki: request.body.devicePublicKeySpki,
    devicePublicKeySpkiSha256: request.body.devicePublicKeySpkiSha256,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    devicePlatform: AGENT_PLATFORM_COMPANION_DEVICE_PLATFORM,
    companionVersion: request.body.companionVersion,
    state: 'active',
    issuedAt: now.toISOString(),
    validFrom: now.toISOString(),
    validUntil: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1_000).toISOString(),
    ...safety,
  });
}

function signCompanionEnrollmentCertificateForTest(
  body: CompanionEnrollmentCertificateBody,
  keyId: string,
  privateKey: KeyObject,
): SignedCompanionEnrollmentCertificate {
  const bodyDigest = digestCompanionEnrollmentCertificateBody(body);
  const transcript = canonicalCompanionEnrollmentCertificateSignatureBytes(body, keyId);
  if (!bodyDigest || !transcript) throw new Error('invalid synthetic certificate');
  return Object.freeze({
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    transcriptVersion: AGENT_PLATFORM_COMPANION_CERTIFICATE_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
    bodyDigest,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
    signerKeyId: keyId,
    body,
    signature: sign('sha256', transcript, {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url'),
  });
}

function signedLookupAssignment(
  certificate: SignedCompanionEnrollmentCertificate,
  privateKey: KeyObject,
  assignmentId: string,
  requestId: string,
  leaseNonceDigest: string,
): SignedKemerBetExactFiveLookupAssignment {
  const body: KemerBetExactFiveLookupAssignmentBody = Object.freeze({
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    assignmentId,
    requestId,
    certificateId: certificate.body.certificateId,
    deviceId: certificate.body.deviceId,
    deviceKeyId: certificate.body.deviceKeyId,
    platformCode: 'kemerbet',
    assignmentKind: 'exact_five_player_lookup',
    lookupMode: 'find_only',
    playerIds: ['28379330', '28379331', '28379332', '28379333', '28379334'] as const,
    currencyCode: 'ETB',
    leaseNonceDigest,
    oneUse: true,
    issuedAt: new Date(now.getTime() + 1_000).toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60 * 1_000).toISOString(),
    ...safety,
  });
  const bodyDigest = digestKemerBetExactFiveLookupAssignmentBody(body);
  const transcript = canonicalKemerBetExactFiveLookupAssignmentSignatureBytes(body, signerKeyId);
  if (!bodyDigest || !transcript) throw new Error('invalid synthetic assignment');
  return Object.freeze({
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    transcriptVersion: AGENT_PLATFORM_COMPANION_ASSIGNMENT_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
    bodyDigest,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
    signerKeyId,
    body,
    signature: sign('sha256', transcript, {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url'),
  });
}

function successfulFetch(
  serverPrivateKey: KeyObject,
  certificateOverrides: Partial<CompanionEnrollmentCertificateBody> = {},
  onResponseRead?: () => void,
) {
  return vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('error');
    const request = JSON.parse(String(init?.body)) as SignedCompanionPairingRequest;
    expect(verifySignedCompanionPairingRequest(request)).toBe(true);
    expect(request.body.issuedAt).toBe(now.toISOString());
    expect(Date.parse(request.body.expiresAt) - Date.parse(request.body.issuedAt)).toBe(
      12 * 60 * 60 * 1_000,
    );
    const certificate = signCompanionEnrollmentCertificateForTest(
      { ...certificateBody(request), ...certificateOverrides },
      signerKeyId,
      serverPrivateKey,
    );
    const encoded = JSON.stringify({ certificate });
    const responseBody = onResponseRead
      ? new ReadableStream<Uint8Array>({
          pull(controller) {
            onResponseRead();
            controller.enqueue(Buffer.from(encoded));
            controller.close();
          },
        })
      : encoded;
    return new Response(responseBody, {
      status: 201,
      headers: {
        'content-length': String(Buffer.byteLength(encoded)),
        'content-type': COMPANION_PAIRING_CONTENT_TYPE,
      },
    });
  });
}

describe('Windows companion device enrollment', () => {
  it('assesses a newly issued certificate after reading the response, not before pairing started', async () => {
    const dataRoot = await root();
    const server = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const publicKey = Buffer.from(server.publicKey.export({ format: 'der', type: 'spki' }));
    let observedNow = now;
    const issuedAt = new Date(now.getTime() + 2_000).toISOString();
    const fetchImplementation = successfulFetch(
      server.privateKey,
      { issuedAt, validFrom: issuedAt },
      () => {
        observedNow = new Date(now.getTime() + 3_000);
      },
    );
    await expect(
      ensureCompanionDeviceEnrollment({
        dataRoot,
        releaseSha,
        pairingPackage: pairingPackage(publicKey),
        fetch: fetchImplementation as unknown as typeof fetch,
        now: () => observedNow,
        protector: protector(),
      }),
    ).resolves.toMatchObject({ devicePaired: true });
    await expect(
      readFile(join(dataRoot, 'device', 'companion-primary.enrollment.json'), 'utf8'),
    ).resolves.toContain(issuedAt);
  });

  it.each(['expired-during-response', 'still-future', 'invalid-clock'] as const)(
    'rejects a certificate at the actual response time: %s',
    async (scenario) => {
      const dataRoot = await root();
      const server = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      const publicKey = Buffer.from(server.publicKey.export({ format: 'der', type: 'spki' }));
      let observedNow = now;
      const later = new Date(now.getTime() + 2_000).toISOString();
      const overrides =
        scenario === 'expired-during-response'
          ? { validUntil: later }
          : scenario === 'still-future'
            ? { issuedAt: later, validFrom: later }
            : {};
      await expect(
        ensureCompanionDeviceEnrollment({
          dataRoot,
          releaseSha,
          pairingPackage: pairingPackage(publicKey),
          fetch: successfulFetch(server.privateKey, overrides, () => {
            observedNow =
              scenario === 'invalid-clock'
                ? new Date(Number.NaN)
                : new Date(now.getTime() + (scenario === 'still-future' ? 1_000 : 3_000));
          }) as unknown as typeof fetch,
          now: () => observedNow,
          protector: protector(),
        }),
      ).rejects.toMatchObject({ code: 'FETANAGENT_DEVICE_ENROLLMENT_REJECTED' });
      await expect(
        readFile(join(dataRoot, 'device', 'companion-primary.enrollment.json')),
      ).rejects.toThrow();
    },
  );

  it('restores only the already-issued, pinned certificate for the existing protected key', async () => {
    const dataRoot = await root();
    const server = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const publicKey = Buffer.from(server.publicKey.export({ format: 'der', type: 'spki' }));
    const selectedProtector = protector();
    await ensureCompanionDeviceEnrollment({
      dataRoot,
      releaseSha,
      pairingPackage: pairingPackage(publicKey),
      fetch: successfulFetch(server.privateKey) as unknown as typeof fetch,
      now: () => now,
      protector: selectedProtector,
    });
    const enrollmentPath = join(dataRoot, 'device', 'companion-primary.enrollment.json');
    const keyPath = join(dataRoot, 'device', 'companion-primary.key.json');
    const keyBefore = await readFile(keyPath);
    const enrollment = JSON.parse(await readFile(enrollmentPath, 'utf8'));
    await rm(enrollmentPath);
    const options = {
      dataRoot,
      enrollment,
      expectedServerSignerKeyId: signerKeyId,
      expectedServerSigningPublicKeySpkiSha256: sha(publicKey),
      now: () => now,
      protector: selectedProtector,
    };
    await expect(restoreCompanionDeviceEnrollment(options)).resolves.toMatchObject({
      alreadyPaired: false,
      devicePaired: true,
      transferDisabled: true,
    });
    await expect(restoreCompanionDeviceEnrollment(options)).resolves.toMatchObject({
      alreadyPaired: true,
      devicePaired: true,
    });
    expect(await readFile(keyPath)).toEqual(keyBefore);

    await rm(enrollmentPath);
    await expect(
      restoreCompanionDeviceEnrollment({
        ...options,
        expectedServerSignerKeyId: 'another-server-key',
      }),
    ).rejects.toMatchObject({ code: 'FETANAGENT_DEVICE_ENROLLMENT_REJECTED' });
    await expect(
      restoreCompanionDeviceEnrollment({
        ...options,
        expectedServerSigningPublicKeySpkiSha256: `sha256:${'0'.repeat(64)}`,
      }),
    ).rejects.toMatchObject({ code: 'FETANAGENT_DEVICE_ENROLLMENT_REJECTED' });
    await expect(
      restoreCompanionDeviceEnrollment({
        ...options,
        now: () => new Date('2027-01-01T00:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'FETANAGENT_DEVICE_ENROLLMENT_REJECTED' });
    const altered = structuredClone(enrollment);
    altered.certificate.body.transferAllowed = true;
    await expect(
      restoreCompanionDeviceEnrollment({ ...options, enrollment: altered }),
    ).rejects.toMatchObject({ code: 'FETANAGENT_DEVICE_ENROLLMENT_REJECTED' });
    const wrongSignature = structuredClone(enrollment);
    wrongSignature.certificate.signature = 'A'.repeat(86);
    await expect(
      restoreCompanionDeviceEnrollment({ ...options, enrollment: wrongSignature }),
    ).rejects.toMatchObject({ code: 'FETANAGENT_DEVICE_ENROLLMENT_REJECTED' });
    await expect(readFile(enrollmentPath)).rejects.toThrow();

    const otherRoot = await root();
    await ensureCompanionDeviceEnrollment({
      dataRoot: otherRoot,
      releaseSha,
      pairingPackage: pairingPackage(publicKey),
      fetch: successfulFetch(server.privateKey) as unknown as typeof fetch,
      now: () => now,
      protector: selectedProtector,
    });
    const otherEnrollmentPath = join(otherRoot, 'device', 'companion-primary.enrollment.json');
    await rm(otherEnrollmentPath);
    await expect(
      restoreCompanionDeviceEnrollment({ ...options, dataRoot: otherRoot }),
    ).rejects.toMatchObject({ code: 'FETANAGENT_DEVICE_ENROLLMENT_REJECTED' });
    await expect(readFile(otherEnrollmentPath)).rejects.toThrow();

    await writeFile(enrollmentPath, 'existing-enrollment-must-not-be-overwritten');
    await expect(restoreCompanionDeviceEnrollment(options)).rejects.toMatchObject({
      code: 'FETANAGENT_DEVICE_ENROLLMENT_UNAVAILABLE',
    });
    expect(await readFile(enrollmentPath, 'utf8')).toBe(
      'existing-enrollment-must-not-be-overwritten',
    );
    expect(await readFile(keyPath)).toEqual(keyBefore);
  });

  it('creates a DPAPI-protected device key, pairs once, and resumes without a package', async () => {
    const dataRoot = await root();
    const server = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const serverPublicKey = Buffer.from(server.publicKey.export({ format: 'der', type: 'spki' }));
    const fetchImplementation = successfulFetch(server.privateKey);

    await expect(
      ensureCompanionDeviceEnrollment({
        dataRoot,
        pairingPackage: pairingPackage(serverPublicKey),
        releaseSha,
        fetch: fetchImplementation as unknown as typeof fetch,
        now: () => now,
        protector: protector(),
      }),
    ).resolves.toEqual({
      alreadyPaired: false,
      devicePaired: true,
      identifiersRedacted: true,
      pairingRequired: false,
      transferDisabled: true,
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);

    const keyFile = await readFile(join(dataRoot, 'device', 'companion-primary.key.json'), 'utf8');
    const enrollmentFile = await readFile(
      join(dataRoot, 'device', 'companion-primary.enrollment.json'),
      'utf8',
    );
    expect(keyFile).toContain('windows-dpapi-current-user');
    expect(keyFile).toContain('protectedPrivateKeyBase64');
    expect(keyFile).not.toContain('privateKeyPkcs8');
    expect(enrollmentFile).not.toContain('protectedPrivateKeyBase64');
    expect(enrollmentFile).not.toContain('moneyMovementAllowed":true');

    await expect(
      ensureCompanionDeviceEnrollment({
        dataRoot,
        releaseSha,
        fetch: vi.fn(async () => {
          throw new Error('network must not be used');
        }) as unknown as typeof fetch,
        now: () => now,
        protector: protector(),
      }),
    ).resolves.toMatchObject({ alreadyPaired: true, devicePaired: true, pairingRequired: false });
  });

  it('requires a package without generating or uploading a device key', async () => {
    const dataRoot = await root();
    await expect(
      ensureCompanionDeviceEnrollment({
        dataRoot,
        releaseSha,
        now: () => now,
        protector: protector(),
      }),
    ).resolves.toEqual({
      alreadyPaired: false,
      devicePaired: false,
      identifiersRedacted: true,
      pairingRequired: true,
      transferDisabled: true,
    });
    await expect(
      readFile(join(dataRoot, 'device', 'companion-primary.key.json')),
    ).rejects.toThrow();
  });

  it('rejects expired, wrong-host, weakened, and non-canonical packages before networking', async () => {
    const server = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const publicKey = Buffer.from(server.publicKey.export({ format: 'der', type: 'spki' }));
    const candidates = [
      pairingPackage(publicKey, { expiresAt: now.toISOString() }),
      pairingPackage(publicKey, {
        expiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1_000 + 1).toISOString(),
      }),
      pairingPackage(publicKey, {
        endpoint: `https://example.invalid${COMPANION_PAIRING_PATH}`,
      }),
      pairingPackage(publicKey, { transferDisabled: false }),
      `${pairingPackage(publicKey)}=`,
    ];
    for (const candidate of candidates) {
      expect(decodeCompanionPairingPackage(candidate, now)).toBeUndefined();
    }
  });

  it('fails closed when the returned certificate is signed by the wrong server key', async () => {
    const dataRoot = await root();
    const trusted = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const attacker = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const trustedPublicKey = Buffer.from(trusted.publicKey.export({ format: 'der', type: 'spki' }));
    await expect(
      ensureCompanionDeviceEnrollment({
        dataRoot,
        pairingPackage: pairingPackage(trustedPublicKey),
        releaseSha,
        fetch: successfulFetch(attacker.privateKey) as unknown as typeof fetch,
        now: () => now,
        protector: protector(),
      }),
    ).rejects.toMatchObject({ code: 'FETANAGENT_DEVICE_ENROLLMENT_REJECTED' });
  });

  it('binds every stored lookup result to the exact current assignment before submission', async () => {
    const dataRoot = await root();
    const server = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const serverPublicKey = Buffer.from(server.publicKey.export({ format: 'der', type: 'spki' }));
    const selectedProtector = protector();
    await ensureCompanionDeviceEnrollment({
      dataRoot,
      pairingPackage: pairingPackage(serverPublicKey),
      releaseSha,
      fetch: successfulFetch(server.privateKey) as unknown as typeof fetch,
      now: () => now,
      protector: selectedProtector,
    });
    const runtime = await loadCompanionDeviceSigningRuntime({
      dataRoot,
      now: () => new Date(now.getTime() + 30_000),
      protector: selectedProtector,
    });
    const launchContext = {
      challenge: Buffer.alloc(32, 0x53).toString('base64url'),
      releaseSha,
      installationTreeSha256: `sha256:${'f'.repeat(64)}`,
      processId: 4242,
      startedAt: '2026-09-04T12:00:00.000Z',
      observedAt: '2026-09-04T12:00:30.000Z',
    };
    const launchProof = runtime.createSignedLaunchProof(launchContext);
    expect(
      verifyCompanionLaunchProof(launchProof, {
        ...launchContext,
        certificateBodyDigest: runtime.certificate.bodyDigest,
        deviceKeyId: runtime.certificate.body.deviceKeyId,
        devicePublicKeySpki: runtime.certificate.body.devicePublicKeySpki,
      }),
    ).toBe(true);
    const assignment = signedLookupAssignment(
      runtime.certificate,
      server.privateKey,
      'lookup-assignment-0001',
      'lookup-request-0001',
      `sha256:${'1'.repeat(64)}`,
    );
    const otherAssignment = signedLookupAssignment(
      runtime.certificate,
      server.privateKey,
      'lookup-assignment-0002',
      'lookup-request-0002',
      `sha256:${'2'.repeat(64)}`,
    );
    const assessedAt = new Date(now.getTime() + 30_000);
    expect(runtime.decodeAndVerifyAssignment(assignment, assessedAt)).toEqual(assignment);
    const result = runtime.createSignedLookupResult(
      assignment,
      ['found', 'review_required', 'found', 'review_required', 'found'],
      new Date(now.getTime() + 20_000),
    );
    expect(runtime.verifyLookupExchange(assignment, result, assessedAt)).toBe(true);
    expect(runtime.verifyLookupExchange(otherAssignment, result, assessedAt)).toBe(false);
  });

  it('verifies the independently pinned execution chain and signs only a bound result', async () => {
    const dataRoot = await root();
    const noMoneyServer = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const noMoneySpki = Buffer.from(
      noMoneyServer.publicKey.export({ format: 'der', type: 'spki' }),
    );
    const executionSigner = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const executionSpki = Buffer.from(
      executionSigner.publicKey.export({ format: 'der', type: 'spki' }),
    );
    const selectedProtector = protector();
    await ensureCompanionDeviceEnrollment({
      dataRoot,
      pairingPackage: pairingPackage(noMoneySpki),
      releaseSha,
      fetch: successfulFetch(noMoneyServer.privateKey) as unknown as typeof fetch,
      now: () => now,
      protector: selectedProtector,
    });
    const platformAgentAccountId = 'platform-agent-account-0001';
    const executionSignerKeyId = 'execution-signer-production-0001';
    const runtime = await loadCompanionDeviceSigningRuntime({
      dataRoot,
      now: () => new Date(now.getTime() + 40_000),
      protector: selectedProtector,
      execution: {
        expectedPlatformAgentAccountId: platformAgentAccountId,
        trustedExecutionSignerKeyId: executionSignerKeyId,
        trustedExecutionSignerPublicKeySpki: executionSpki.toString('base64url'),
        trustedExecutionSignerPublicKeySpkiSha256: sha(executionSpki),
      },
    });
    const execution = runtime.execution!;
    expect(execution.pollEndpoint).toBe(
      `https://device.fetanagent.com${COMPANION_EXECUTION_POLL_PATH}`,
    );
    expect(
      runtime.createSignedHttpRequest(
        COMPANION_EXECUTION_POLL_PATH,
        `sha256:${'f'.repeat(64)}`,
        new Date(now.getTime() + 40_000),
      ).body.canonicalPath,
    ).toBe(COMPANION_EXECUTION_POLL_PATH);

    const enrollmentBody: ExecutionEnrollmentBody = Object.freeze({
      contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
      protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
      capability: COMPANION_EXECUTION_CAPABILITY,
      enrollmentId: 'execution-enrollment-0001',
      noMoneyCertificateId: runtime.certificate.body.certificateId,
      noMoneyCertificateBodyDigest: runtime.certificate.bodyDigest,
      deviceId: runtime.certificate.body.deviceId,
      deviceKeyId: runtime.certificate.body.deviceKeyId,
      devicePublicKeySpkiSha256: runtime.certificate.body.devicePublicKeySpkiSha256,
      platformAgentAccountId,
      accountBindingCount: 1,
      platformCode: COMPANION_EXECUTION_PLATFORM_CODE,
      pilotId: 'private-pilot-0001',
      pilotRevision: '7',
      pilotConfigDigest: `sha256:${'3'.repeat(64)}`,
      amountMinorUnits: COMPANION_EXECUTION_AMOUNT_MINOR_UNITS,
      currencyCode: COMPANION_EXECUTION_CURRENCY_CODE,
      maxActionsPerAssignment: 1,
      maxAssignmentLifetimeMs: 60_000,
      maxAuthorityLifetimeMs: 10_000,
      maxStatusLifetimeMs: 8_000,
      maxRoundTripTimeMs: 5_000,
      executionSignerKeyId,
      executionSignerPublicKeySpki: executionSpki.toString('base64url'),
      executionSignerPublicKeySpkiSha256: sha(executionSpki),
      capabilityState: 'active',
      issuedAt: new Date(now.getTime() + 1_000).toISOString(),
      validFrom: new Date(now.getTime() + 1_000).toISOString(),
      validUntil: new Date(now.getTime() + 3_600_000).toISOString(),
    });
    const enrollment = signExecutionEnrollment(enrollmentBody, executionSigner.privateKey)!;
    expect(Buffer.byteLength(JSON.stringify(enrollment), 'utf8')).toBeLessThan(3_500);
    const playerId = '28379330';
    const assignmentBody: ExecutionAssignmentBody = Object.freeze({
      contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
      protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
      capability: COMPANION_EXECUTION_CAPABILITY,
      actionKind: COMPANION_EXECUTION_ACTION_KIND,
      assignmentId: 'execution-assignment-0001',
      assignmentNonceDigest: `sha256:${'4'.repeat(64)}`,
      activationEpoch: '11',
      intentId: 'deposit-intent-0001',
      jobId: 'deposit-job-0001',
      attemptId: 'deposit-attempt-0001',
      platformAgentAccountId,
      enrollmentId: enrollment.body.enrollmentId,
      enrollmentBodyDigest: enrollment.bodyDigest,
      noMoneyCertificateId: enrollment.body.noMoneyCertificateId,
      noMoneyCertificateBodyDigest: enrollment.body.noMoneyCertificateBodyDigest,
      deviceId: enrollment.body.deviceId,
      deviceKeyId: enrollment.body.deviceKeyId,
      executionSignerKeyId,
      platformCode: COMPANION_EXECUTION_PLATFORM_CODE,
      pilotId: enrollment.body.pilotId,
      pilotRevision: enrollment.body.pilotRevision,
      pilotConfigDigest: enrollment.body.pilotConfigDigest,
      pilotReservationId: 'pilot-reservation-0001',
      pilotReservationDigest: `sha256:${'5'.repeat(64)}`,
      amountMinorUnits: COMPANION_EXECUTION_AMOUNT_MINOR_UNITS,
      currencyCode: COMPANION_EXECUTION_CURRENCY_CODE,
      playerIdDigest: digestCompanionExecutionPlayerId(playerId)!,
      oneUse: true,
      serverIssuedAt: new Date(now.getTime() + 30_000).toISOString(),
      serverNotBefore: new Date(now.getTime() + 30_000).toISOString(),
      serverValidUntil: new Date(now.getTime() + 90_000).toISOString(),
    });
    const assignment = signExecutionAssignment(assignmentBody, executionSigner.privateKey)!;
    expect(Buffer.byteLength(JSON.stringify(assignment), 'utf8')).toBeLessThan(3_500);
    const roundTrip = { monotonicRequestStartedMs: 1_000, monotonicResponseReceivedMs: 1_100 };
    const chain = execution.verifyAssignment(
      enrollment,
      assignment,
      playerId,
      new Date(now.getTime() + 40_000),
      roundTrip,
    )!;
    expect(chain.assignment).toEqual(assignment);
    expect(
      execution.verifyAssignment(
        enrollment,
        assignment,
        'wrong-player',
        new Date(now.getTime() + 40_000),
        roundTrip,
      ),
    ).toBeUndefined();

    const requestNonceDigest = digestCompanionExecutionNonce(Buffer.alloc(32, 7))!;
    const authorityBody: OneUseActionAuthorityBody = Object.freeze({
      contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
      protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
      capability: COMPANION_EXECUTION_CAPABILITY,
      actionKind: COMPANION_EXECUTION_ACTION_KIND,
      authorityId: 'one-use-authority-0001',
      assignmentId: assignment.body.assignmentId,
      assignmentBodyDigest: assignment.bodyDigest,
      activationEpoch: assignment.body.activationEpoch,
      intentId: assignment.body.intentId,
      jobId: assignment.body.jobId,
      attemptId: assignment.body.attemptId,
      platformAgentAccountId,
      enrollmentId: assignment.body.enrollmentId,
      enrollmentBodyDigest: assignment.body.enrollmentBodyDigest,
      noMoneyCertificateId: assignment.body.noMoneyCertificateId,
      noMoneyCertificateBodyDigest: assignment.body.noMoneyCertificateBodyDigest,
      deviceId: assignment.body.deviceId,
      deviceKeyId: assignment.body.deviceKeyId,
      executionSignerKeyId,
      platformCode: assignment.body.platformCode,
      pilotId: assignment.body.pilotId,
      pilotRevision: assignment.body.pilotRevision,
      pilotConfigDigest: assignment.body.pilotConfigDigest,
      pilotReservationId: assignment.body.pilotReservationId,
      pilotReservationDigest: assignment.body.pilotReservationDigest,
      amountMinorUnits: assignment.body.amountMinorUnits,
      currencyCode: assignment.body.currencyCode,
      playerIdDigest: assignment.body.playerIdDigest,
      fenceId: 'database-fence-0001',
      fenceNonceDigest: `sha256:${'6'.repeat(64)}`,
      databaseFenceState: 'first_fence_acquired',
      firstFenceAcquired: true,
      requestNonceDigest,
      oneUse: true,
      databaseFencedAt: new Date(now.getTime() + 41_000).toISOString(),
      databaseAuthorityIssuedAt: new Date(now.getTime() + 42_000).toISOString(),
      serverValidUntil: new Date(now.getTime() + 49_000).toISOString(),
    });
    const authority = signOneUseActionAuthority(authorityBody, executionSigner.privateKey)!;
    expect(Buffer.byteLength(JSON.stringify(authority), 'utf8')).toBeLessThan(3_500);
    const verifiedAuthority = execution.verifyAuthority(
      authority,
      chain,
      requestNonceDigest,
      new Date(now.getTime() + 42_000),
      roundTrip,
    )!;
    expect(verifiedAuthority.authority).toEqual(authority);
    expect(
      execution.verifyAuthority(
        authority,
        chain,
        `sha256:${'9'.repeat(64)}`,
        new Date(now.getTime() + 42_000),
        roundTrip,
      ),
    ).toBeUndefined();

    const resultBody: ExecutionResultBody = Object.freeze({
      contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
      protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
      capability: COMPANION_EXECUTION_CAPABILITY,
      actionKind: COMPANION_EXECUTION_ACTION_KIND,
      resultId: 'execution-result-0001',
      assignmentId: assignment.body.assignmentId,
      assignmentBodyDigest: assignment.bodyDigest,
      authorityId: authority.body.authorityId,
      authorityBodyDigest: authority.bodyDigest,
      activationEpoch: assignment.body.activationEpoch,
      intentId: assignment.body.intentId,
      jobId: assignment.body.jobId,
      attemptId: assignment.body.attemptId,
      platformAgentAccountId,
      enrollmentId: assignment.body.enrollmentId,
      enrollmentBodyDigest: assignment.body.enrollmentBodyDigest,
      noMoneyCertificateId: assignment.body.noMoneyCertificateId,
      noMoneyCertificateBodyDigest: assignment.body.noMoneyCertificateBodyDigest,
      deviceId: assignment.body.deviceId,
      deviceKeyId: assignment.body.deviceKeyId,
      executionSignerKeyId,
      platformCode: assignment.body.platformCode,
      pilotId: assignment.body.pilotId,
      pilotRevision: assignment.body.pilotRevision,
      pilotConfigDigest: assignment.body.pilotConfigDigest,
      pilotReservationId: assignment.body.pilotReservationId,
      pilotReservationDigest: assignment.body.pilotReservationDigest,
      amountMinorUnits: assignment.body.amountMinorUnits,
      currencyCode: assignment.body.currencyCode,
      playerIdDigest: assignment.body.playerIdDigest,
      fenceId: authority.body.fenceId,
      fenceNonceDigest: authority.body.fenceNonceDigest,
      requestNonceDigest: authority.body.requestNonceDigest,
      outcome: 'submission_attempted',
      finalActionStarted: true,
      finalActionStartedAt: new Date(now.getTime() + 43_000).toISOString(),
      providerResponseDigest: `sha256:${'8'.repeat(64)}`,
      evidenceDigest: `sha256:${'9'.repeat(64)}`,
      reportedAt: new Date(now.getTime() + 44_000).toISOString(),
    });
    const result = execution.createSignedResult(
      resultBody,
      chain,
      authority,
      new Date(now.getTime() + 44_000),
    );
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThan(3_500);
    const queryNonceDigest = digestCompanionExecutionNonce(Buffer.alloc(32, 8))!;
    const statusBody: AuthoritativeExecutionStatusBody = Object.freeze({
      contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
      protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
      statusKind: 'authoritative_execution_status',
      grantsActionAuthority: false,
      oneUseActionAuthority: false,
      capability: COMPANION_EXECUTION_CAPABILITY,
      actionKind: COMPANION_EXECUTION_ACTION_KIND,
      statusId: 'authoritative-status-0001',
      statusSequence: '7',
      queryNonceDigest,
      assignmentId: assignment.body.assignmentId,
      assignmentBodyDigest: assignment.bodyDigest,
      authorityId: authority.body.authorityId,
      authorityBodyDigest: authority.bodyDigest,
      activationEpoch: assignment.body.activationEpoch,
      intentId: assignment.body.intentId,
      jobId: assignment.body.jobId,
      attemptId: assignment.body.attemptId,
      platformAgentAccountId,
      enrollmentId: assignment.body.enrollmentId,
      enrollmentBodyDigest: assignment.body.enrollmentBodyDigest,
      noMoneyCertificateId: assignment.body.noMoneyCertificateId,
      noMoneyCertificateBodyDigest: assignment.body.noMoneyCertificateBodyDigest,
      deviceId: assignment.body.deviceId,
      deviceKeyId: assignment.body.deviceKeyId,
      executionSignerKeyId,
      platformCode: assignment.body.platformCode,
      pilotId: assignment.body.pilotId,
      pilotRevision: assignment.body.pilotRevision,
      pilotConfigDigest: assignment.body.pilotConfigDigest,
      pilotReservationId: assignment.body.pilotReservationId,
      pilotReservationDigest: assignment.body.pilotReservationDigest,
      amountMinorUnits: assignment.body.amountMinorUnits,
      currencyCode: assignment.body.currencyCode,
      playerIdDigest: assignment.body.playerIdDigest,
      fenceId: authority.body.fenceId,
      databaseFenceState: 'consumed',
      databaseAttemptState: 'submission_attempted',
      databaseReconciliationState: 'succeeded',
      terminalState: 'succeeded',
      executionResultBodyDigest: result.bodyDigest,
      providerResponseDigest: result.body.providerResponseDigest,
      evidenceDigest: result.body.evidenceDigest,
      databaseObservedAt: new Date(now.getTime() + 45_000).toISOString(),
      serverIssuedAt: new Date(now.getTime() + 45_000).toISOString(),
      serverValidUntil: new Date(now.getTime() + 50_000).toISOString(),
    });
    const status = signAuthoritativeExecutionStatus(statusBody, executionSigner.privateKey)!;
    expect(
      execution.verifyStatus(
        status,
        chain,
        authority,
        result,
        queryNonceDigest,
        '1',
        new Date(now.getTime() + 45_000),
        roundTrip,
      ),
    ).toEqual(status);
    executionSpki.fill(0);
  });
});
