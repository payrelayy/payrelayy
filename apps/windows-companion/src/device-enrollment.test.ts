import { createHash, generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  COMPANION_PAIRING_CONTENT_TYPE,
  COMPANION_PAIRING_PACKAGE_PREFIX,
  COMPANION_PAIRING_PATH,
  WINDOWS_COMPANION_VERSION,
  decodeCompanionPairingPackage,
  ensureCompanionDeviceEnrollment,
  loadCompanionDeviceSigningRuntime,
} from './device-enrollment.js';
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
    expiresAt: new Date(now.getTime() + 10 * 60 * 1_000).toISOString(),
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

function successfulFetch(serverPrivateKey: KeyObject) {
  return vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('error');
    const request = JSON.parse(String(init?.body)) as SignedCompanionPairingRequest;
    expect(verifySignedCompanionPairingRequest(request)).toBe(true);
    const certificate = signCompanionEnrollmentCertificateForTest(
      certificateBody(request),
      signerKeyId,
      serverPrivateKey,
    );
    const encoded = JSON.stringify({ certificate });
    return new Response(encoded, {
      status: 201,
      headers: {
        'content-length': String(Buffer.byteLength(encoded)),
        'content-type': COMPANION_PAIRING_CONTENT_TYPE,
      },
    });
  });
}

describe('Windows companion device enrollment', () => {
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
});
