import { createHash, createPublicKey, verify } from 'node:crypto';
import { isProxy } from 'node:util/types';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const REASON = /^[a-z][a-z0-9_]{0,63}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u;
const DOMAIN = 'telebirr-routine-paid-check-reason-v1';

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== keys.length
  )
    return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
  });
}

function utc(value: unknown): value is string {
  if (typeof value !== 'string' || !UTC.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

/** ASCII-only fields make this transcript identical to Android's strict JSON array. */
export function routinePaidCheckReportSignatureBytes(body: {
  readonly version: 1;
  readonly candidateId: string;
  readonly challengeId: string;
  readonly challengeDigest: string;
  readonly reasonCode: string;
  readonly checkedAt: string;
}): Buffer {
  return Buffer.from(
    JSON.stringify([
      DOMAIN,
      body.version,
      body.candidateId,
      body.challengeId,
      body.challengeDigest,
      body.reasonCode,
      body.checkedAt,
    ]),
    'utf8',
  );
}

export interface VerifiedRoutinePaidCheckReport {
  readonly candidateId: string;
  readonly challengeId: string;
  readonly reasonCode: string;
  readonly checkedAt: string;
  readonly reportDigest: string;
}

/** Phone-authenticated diagnostic only. No receipt fact or financial authority is returned. */
export function verifyRoutinePaidCheckReport(
  report: unknown,
  lookup: unknown,
  assessedAt: string,
  enrolledDeviceSpkiDer: Uint8Array,
): VerifiedRoutinePaidCheckReport | undefined {
  try {
    if (
      !exact(report, ['body', 'signature']) ||
      !exact(report.body, [
        'version',
        'candidateId',
        'challengeId',
        'challengeDigest',
        'reasonCode',
        'checkedAt',
      ]) ||
      !exact(lookup, ['candidateId', 'challengeId', 'challengeDigest', 'issuedAt', 'expiresAt']) ||
      report.body.version !== 1 ||
      typeof report.body.candidateId !== 'string' ||
      !UUID_V4.test(report.body.candidateId) ||
      typeof report.body.challengeId !== 'string' ||
      !UUID_V4.test(report.body.challengeId) ||
      typeof report.body.challengeDigest !== 'string' ||
      !DIGEST.test(report.body.challengeDigest) ||
      typeof report.body.reasonCode !== 'string' ||
      !REASON.test(report.body.reasonCode) ||
      !utc(report.body.checkedAt) ||
      !utc(lookup.issuedAt) ||
      !utc(lookup.expiresAt) ||
      !utc(assessedAt) ||
      lookup.candidateId !== report.body.candidateId ||
      lookup.challengeId !== report.body.challengeId ||
      lookup.challengeDigest !== report.body.challengeDigest ||
      report.body.checkedAt < lookup.issuedAt ||
      Date.parse(report.body.checkedAt) > Date.parse(lookup.expiresAt) + 5_000 ||
      Date.parse(report.body.checkedAt) > Date.parse(assessedAt) + 5_000 ||
      Date.parse(assessedAt) >= Date.parse(lookup.expiresAt) + 15 * 60_000 ||
      typeof report.signature !== 'string' ||
      !SIGNATURE.test(report.signature) ||
      !(enrolledDeviceSpkiDer instanceof Uint8Array) ||
      isProxy(enrolledDeviceSpkiDer)
    )
      return undefined;
    const signature = Buffer.from(report.signature, 'base64url');
    if (signature.byteLength !== 64 || signature.toString('base64url') !== report.signature)
      return undefined;
    const body = report.body as unknown as Parameters<
      typeof routinePaidCheckReportSignatureBytes
    >[0];
    const transcript = routinePaidCheckReportSignatureBytes(body);
    const key = createPublicKey({
      key: Buffer.from(enrolledDeviceSpkiDer),
      format: 'der',
      type: 'spki',
    });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
      return undefined;
    if (!verify('sha256', transcript, { key, dsaEncoding: 'ieee-p1363' }, signature))
      return undefined;
    return Object.freeze({
      candidateId: body.candidateId,
      challengeId: body.challengeId,
      reasonCode: body.reasonCode,
      checkedAt: body.checkedAt,
      reportDigest: `sha256:${createHash('sha256').update(transcript).update(signature).digest('hex')}`,
    });
  } catch {
    return undefined;
  }
}
