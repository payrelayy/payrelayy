import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  COMPANION_EXECUTION_HANDOFF_PURPOSE,
  loadWindowsCompanionExecutionHandoff,
  verifyWindowsCompanionExecutionHandoff,
} from './execution-activation-handoff.js';

const ORDER = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CERTIFICATE_DIGEST = `sha256:${'b'.repeat(64)}`;
const RELEASE = 'c'.repeat(40);
const ARCHIVE_DIGEST = `sha256:${'d'.repeat(64)}`;
const now = new Date('2026-09-26T12:00:00.000Z');

const signer = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const spki = Buffer.from(signer.publicKey.export({ format: 'der', type: 'spki' }));
const signerContext = {
  certificateBodyDigest: CERTIFICATE_DIGEST,
  expectedAccountId: ACCOUNT,
  releaseSha: RELEASE,
  trustedNow: now,
  trustedSignerKeyId: 'test-execution-signer-v1',
  trustedSignerPublicKeySpki: spki.toString('base64url'),
  trustedSignerPublicKeySpkiSha256: `sha256:${createHash('sha256').update(spki).digest('hex')}`,
} as const;

function signedHandoff(overrides: Record<string, unknown> = {}) {
  const body = {
    contractVersion: 1,
    purpose: COMPANION_EXECUTION_HANDOFF_PURPOSE,
    deploymentTarget: 'production',
    requestKey: '11111111-1111-4111-8111-111111111111',
    activationEpoch: '1',
    platformAgentAccountId: ACCOUNT,
    noMoneyCertificateBodyDigest: CERTIFICATE_DIGEST,
    companionReleaseSha: RELEASE,
    companionArchiveSha256: ARCHIVE_DIGEST,
    issuedAt: '2026-09-26T11:59:00.000Z',
    notBefore: '2026-09-26T11:59:00.000Z',
    expiresAt: '2026-09-26T23:59:00.000Z',
    ...overrides,
  };
  const transcript = Buffer.from(
    `${COMPANION_EXECUTION_HANDOFF_PURPOSE}\0${JSON.stringify(body)}`,
    'utf8',
  );
  const signatureBytes = sign('sha256', transcript, {
    key: signer.privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  const s = BigInt(`0x${signatureBytes.subarray(32).toString('hex')}`);
  if (s > ORDER / 2n) {
    const lowS = (ORDER - s).toString(16).padStart(64, '0');
    Buffer.from(lowS, 'hex').copy(signatureBytes, 32);
  }
  return {
    body,
    signerKeyId: signerContext.trustedSignerKeyId,
    signature: signatureBytes.toString('base64url'),
  };
}

const temporaryRoots: string[] = [];
afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('signed Windows companion execution activation handoff', () => {
  it('requires the exact signer, paired certificate, account, release, and twelve-hour window', () => {
    const valid = signedHandoff();
    expect(verifyWindowsCompanionExecutionHandoff(valid, signerContext)).toEqual({
      accountId: ACCOUNT,
      activationEpoch: '1',
      archiveSha256: ARCHIVE_DIGEST,
      expiresAtMs: Date.parse('2026-09-26T23:59:00.000Z'),
      requestKey: valid.body.requestKey,
    });
    for (const context of [
      { ...signerContext, expectedAccountId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
      { ...signerContext, releaseSha: 'f'.repeat(40) },
      { ...signerContext, certificateBodyDigest: `sha256:${'e'.repeat(64)}` },
      { ...signerContext, trustedNow: new Date('2026-09-27T00:00:00.000Z') },
      { ...signerContext, trustedSignerKeyId: 'another-signer' },
    ]) {
      expect(() => verifyWindowsCompanionExecutionHandoff(valid, context)).toThrow(
        'signed Windows companion execution handoff is unavailable',
      );
    }
  });

  it('rejects tampering, extended windows, malformed signatures, and extra fields', () => {
    const signed = signedHandoff();
    expect(() =>
      verifyWindowsCompanionExecutionHandoff(
        { ...signed, body: { ...signed.body, activationEpoch: '2' } },
        signerContext,
      ),
    ).toThrow();
    for (const body of [
      { ...signed.body, expiresAt: '2026-09-27T00:00:00.001Z' },
      { ...signed.body, unexpectedField: true },
      { ...signed.body, deploymentTarget: 'staging' },
    ]) {
      expect(() =>
        verifyWindowsCompanionExecutionHandoff({ ...signed, body }, signerContext),
      ).toThrow();
    }
    expect(() =>
      verifyWindowsCompanionExecutionHandoff(
        { ...signed, signature: 'A'.repeat(86) },
        signerContext,
      ),
    ).toThrow();
  });

  it('loads only a canonical fixed-path local file; no flag or account text can substitute', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'fetanagent-execution-handoff-'));
    temporaryRoots.push(root);
    const directory = resolve(root, 'execution-v2');
    const file = resolve(directory, 'activation-handoff.v1.json');
    await mkdir(directory);
    await expect(loadWindowsCompanionExecutionHandoff(root, signerContext)).rejects.toThrow();
    const handoff = signedHandoff();
    await writeFile(file, JSON.stringify(handoff), { flag: 'wx' });
    await expect(loadWindowsCompanionExecutionHandoff(root, signerContext)).resolves.toEqual({
      accountId: ACCOUNT,
      activationEpoch: '1',
      archiveSha256: ARCHIVE_DIGEST,
      expiresAtMs: Date.parse('2026-09-26T23:59:00.000Z'),
      requestKey: handoff.body.requestKey,
    });
    await writeFile(file, `${JSON.stringify(handoff)}\n`);
    await expect(loadWindowsCompanionExecutionHandoff(root, signerContext)).rejects.toThrow();
  });
});
