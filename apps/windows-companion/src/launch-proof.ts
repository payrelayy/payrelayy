import { createHash, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';

export const COMPANION_LAUNCH_PROOF_PURPOSE =
  'fetanagent:windows-companion:paired-process-launch-proof:v1' as const;

const ORDER = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const RELEASE = /^[0-9a-f]{40}$/u;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const BODY_KEYS = [
  'contractVersion',
  'purpose',
  'challengeDigest',
  'certificateBodyDigest',
  'deviceKeyId',
  'releaseSha',
  'installationTreeSha256',
  'processId',
  'startedAt',
  'observedAt',
] as const;
const ENVELOPE_KEYS = ['body', 'signature'] as const;

export interface CompanionLaunchProofBody {
  readonly contractVersion: 1;
  readonly purpose: typeof COMPANION_LAUNCH_PROOF_PURPOSE;
  readonly challengeDigest: string;
  readonly certificateBodyDigest: string;
  readonly deviceKeyId: string;
  readonly releaseSha: string;
  readonly installationTreeSha256: string;
  readonly processId: number;
  readonly startedAt: string;
  readonly observedAt: string;
}

export interface SignedCompanionLaunchProof {
  readonly body: CompanionLaunchProofBody;
  readonly signature: string;
}

export interface CompanionLaunchProofContext {
  readonly challenge: string;
  readonly certificateBodyDigest: string;
  readonly deviceKeyId: string;
  readonly devicePublicKeySpki: string;
  readonly releaseSha: string;
  readonly installationTreeSha256: string;
  readonly processId: number;
  readonly startedAt: string;
  readonly observedAt: string;
}

function exactKeys(
  candidate: unknown,
  expected: readonly string[],
): candidate is Record<string, unknown> {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
  const actual = Object.keys(candidate);
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function canonicalBytes(encoded: string, expectedLength: number): Buffer | undefined {
  const bytes = Buffer.from(encoded, 'base64url');
  return bytes.length === expectedLength && bytes.toString('base64url') === encoded
    ? bytes
    : undefined;
}

function validTimestamp(value: string): boolean {
  return TIMESTAMP.test(value) && new Date(value).toISOString() === value;
}

function validContext(context: CompanionLaunchProofContext): Buffer | undefined {
  if (
    !CHALLENGE.test(context.challenge) ||
    !SHA256.test(context.certificateBodyDigest) ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u.test(context.deviceKeyId) ||
    !RELEASE.test(context.releaseSha) ||
    !SHA256.test(context.installationTreeSha256) ||
    !Number.isSafeInteger(context.processId) ||
    context.processId <= 0 ||
    !validTimestamp(context.startedAt) ||
    !validTimestamp(context.observedAt) ||
    Date.parse(context.startedAt) > Date.parse(context.observedAt) ||
    Date.parse(context.observedAt) - Date.parse(context.startedAt) > 12 * 60 * 60_000
  ) {
    return undefined;
  }
  return canonicalBytes(context.challenge, 32);
}

function canonicalSignature(raw: Buffer): Buffer {
  const scalar = BigInt(`0x${raw.subarray(32).toString('hex')}`);
  if (scalar > ORDER / 2n) {
    Buffer.from((ORDER - scalar).toString(16).padStart(64, '0'), 'hex').copy(raw, 32);
  }
  return raw;
}

function transcript(body: CompanionLaunchProofBody): Buffer {
  return Buffer.from(`${COMPANION_LAUNCH_PROOF_PURPOSE}\0${JSON.stringify(body)}`, 'utf8');
}

/** Local process evidence only. This never arms execution or replaces archive attestation. */
export function signCompanionLaunchProof(
  context: CompanionLaunchProofContext,
  devicePrivateKey: KeyObject,
): SignedCompanionLaunchProof | undefined {
  try {
    const challenge = validContext(context);
    if (!challenge || devicePrivateKey.asymmetricKeyType !== 'ec') return undefined;
    const publicKey = createPublicKey(devicePrivateKey);
    if (publicKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return undefined;
    const expectedSpki = canonicalBytes(context.devicePublicKeySpki, 91);
    const actualSpki = publicKey.export({ format: 'der', type: 'spki' });
    if (!expectedSpki || !Buffer.isBuffer(actualSpki) || !actualSpki.equals(expectedSpki)) {
      return undefined;
    }
    const body: CompanionLaunchProofBody = Object.freeze({
      contractVersion: 1,
      purpose: COMPANION_LAUNCH_PROOF_PURPOSE,
      challengeDigest: `sha256:${createHash('sha256').update(challenge).digest('hex')}`,
      certificateBodyDigest: context.certificateBodyDigest,
      deviceKeyId: context.deviceKeyId,
      releaseSha: context.releaseSha,
      installationTreeSha256: context.installationTreeSha256,
      processId: context.processId,
      startedAt: context.startedAt,
      observedAt: context.observedAt,
    });
    const signature = canonicalSignature(
      sign('sha256', transcript(body), { key: devicePrivateKey, dsaEncoding: 'ieee-p1363' }),
    );
    return Object.freeze({ body, signature: signature.toString('base64url') });
  } catch {
    return undefined;
  }
}

/** The caller must separately trust the certificate, release archive, and launched OS process. */
export function verifyCompanionLaunchProof(
  candidate: unknown,
  context: CompanionLaunchProofContext,
): boolean {
  try {
    const challenge = validContext(context);
    if (
      !challenge ||
      !exactKeys(candidate, ENVELOPE_KEYS) ||
      !exactKeys(candidate.body, BODY_KEYS) ||
      typeof candidate.signature !== 'string' ||
      !SIGNATURE.test(candidate.signature)
    ) {
      return false;
    }
    const body = candidate.body;
    if (
      body.contractVersion !== 1 ||
      body.purpose !== COMPANION_LAUNCH_PROOF_PURPOSE ||
      body.challengeDigest !== `sha256:${createHash('sha256').update(challenge).digest('hex')}` ||
      body.certificateBodyDigest !== context.certificateBodyDigest ||
      body.deviceKeyId !== context.deviceKeyId ||
      body.releaseSha !== context.releaseSha ||
      body.installationTreeSha256 !== context.installationTreeSha256 ||
      body.processId !== context.processId ||
      body.startedAt !== context.startedAt ||
      body.observedAt !== context.observedAt
    ) {
      return false;
    }
    const signature = canonicalBytes(candidate.signature, 64);
    const spki = canonicalBytes(context.devicePublicKeySpki, 91);
    if (!signature || !spki) return false;
    const scalarR = BigInt(`0x${signature.subarray(0, 32).toString('hex')}`);
    const scalarS = BigInt(`0x${signature.subarray(32).toString('hex')}`);
    if (scalarR <= 0n || scalarR >= ORDER || scalarS <= 0n || scalarS > ORDER / 2n) return false;
    const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
    const canonicalSpki = key.export({ format: 'der', type: 'spki' });
    return (
      key.asymmetricKeyType === 'ec' &&
      key.asymmetricKeyDetails?.namedCurve === 'prime256v1' &&
      Buffer.isBuffer(canonicalSpki) &&
      canonicalSpki.equals(spki) &&
      verify(
        'sha256',
        transcript(body as unknown as CompanionLaunchProofBody),
        { key, dsaEncoding: 'ieee-p1363' },
        signature,
      )
    );
  } catch {
    return false;
  }
}
