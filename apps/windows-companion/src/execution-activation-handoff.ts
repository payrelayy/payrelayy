import { createHash, createPublicKey, verify } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  PRODUCTION_COMPANION_EXECUTION_SIGNER_KEY_ID,
  PRODUCTION_COMPANION_EXECUTION_SIGNER_PUBLIC_KEY_SPKI,
  PRODUCTION_COMPANION_EXECUTION_SIGNER_PUBLIC_KEY_SPKI_SHA256,
} from './config.js';
import { verifyWindowsCompanionInstallationTree } from './installation-tree.js';

const HANDOFF_FILE = 'activation-handoff.v1.json';
export const COMPANION_EXECUTION_HANDOFF_PURPOSE =
  'fetanagent:windows-companion:execution-activation-handoff:v1' as const;
const MAX_HANDOFF_BYTES = 4_096;
const MAX_HANDOFF_LIFETIME_MS = 12 * 60 * 60 * 1_000;
const P256_ORDER = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const BODY_KEYS = [
  'contractVersion',
  'purpose',
  'deploymentTarget',
  'requestKey',
  'activationEpoch',
  'platformAgentAccountId',
  'noMoneyCertificateBodyDigest',
  'companionReleaseSha',
  'companionArchiveSha256',
  'companionInstallationTreeSha256',
  'issuedAt',
  'notBefore',
  'expiresAt',
] as const;
const ENVELOPE_KEYS = ['body', 'signerKeyId', 'signature'] as const;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const RELEASE_SHA = /^[0-9a-f]{40}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export interface WindowsCompanionExecutionHandoff {
  readonly accountId: string;
  readonly activationEpoch: string;
  readonly archiveSha256: string;
  readonly installationTreeSha256: string;
  readonly expiresAtMs: number;
  readonly requestKey: string;
}

export interface WindowsCompanionExecutionHandoffContext {
  readonly certificateBodyDigest: string;
  readonly expectedAccountId: string;
  readonly releaseSha: string;
  readonly trustedNow?: Date;
  readonly trustedSignerKeyId?: string;
  readonly trustedSignerPublicKeySpki?: string;
  readonly trustedSignerPublicKeySpkiSha256?: string;
}

function unavailable(): never {
  throw new Error('The signed Windows companion execution handoff is unavailable.');
}

function exactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function timestamp(value: unknown): number | undefined {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
    ? parsed.getTime()
    : undefined;
}

function canonicalLowSSignature(value: unknown): Buffer | undefined {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{86}$/u.test(value)) return undefined;
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== 64 || bytes.toString('base64url') !== value) return undefined;
  const r = BigInt(`0x${bytes.subarray(0, 32).toString('hex')}`);
  const s = BigInt(`0x${bytes.subarray(32).toString('hex')}`);
  return r > 0n && r < P256_ORDER && s > 0n && s <= P256_ORDER / 2n ? bytes : undefined;
}

/** A signed local gate, never an alternative to the server's one-use database authority. */
export function verifyWindowsCompanionExecutionHandoff(
  candidate: unknown,
  context: WindowsCompanionExecutionHandoffContext,
): WindowsCompanionExecutionHandoff {
  try {
    if (!exactKeys(candidate, ENVELOPE_KEYS) || !exactKeys(candidate.body, BODY_KEYS)) {
      return unavailable();
    }
    const body = candidate.body;
    const issuedAtMs = timestamp(body.issuedAt);
    const notBeforeMs = timestamp(body.notBefore);
    const expiresAtMs = timestamp(body.expiresAt);
    const nowMs = (context.trustedNow ?? new Date()).getTime();
    if (
      body.contractVersion !== 1 ||
      body.purpose !== COMPANION_EXECUTION_HANDOFF_PURPOSE ||
      body.deploymentTarget !== 'production' ||
      typeof body.requestKey !== 'string' ||
      !UUID_V4.test(body.requestKey) ||
      typeof body.activationEpoch !== 'string' ||
      !/^[1-9][0-9]*$/u.test(body.activationEpoch) ||
      BigInt(body.activationEpoch) > 9_223_372_036_854_775_807n ||
      typeof body.platformAgentAccountId !== 'string' ||
      !UUID.test(body.platformAgentAccountId) ||
      body.platformAgentAccountId !== context.expectedAccountId ||
      typeof body.noMoneyCertificateBodyDigest !== 'string' ||
      !DIGEST.test(body.noMoneyCertificateBodyDigest) ||
      body.noMoneyCertificateBodyDigest !== context.certificateBodyDigest ||
      typeof body.companionReleaseSha !== 'string' ||
      !RELEASE_SHA.test(body.companionReleaseSha) ||
      body.companionReleaseSha !== context.releaseSha ||
      typeof body.companionArchiveSha256 !== 'string' ||
      !DIGEST.test(body.companionArchiveSha256) ||
      typeof body.companionInstallationTreeSha256 !== 'string' ||
      !DIGEST.test(body.companionInstallationTreeSha256) ||
      issuedAtMs === undefined ||
      notBeforeMs === undefined ||
      expiresAtMs === undefined ||
      !Number.isFinite(nowMs) ||
      notBeforeMs < issuedAtMs ||
      expiresAtMs <= notBeforeMs ||
      expiresAtMs > issuedAtMs + MAX_HANDOFF_LIFETIME_MS ||
      nowMs < notBeforeMs ||
      nowMs >= expiresAtMs
    ) {
      return unavailable();
    }
    const signerKeyId = context.trustedSignerKeyId ?? PRODUCTION_COMPANION_EXECUTION_SIGNER_KEY_ID;
    const signerSpki =
      context.trustedSignerPublicKeySpki ?? PRODUCTION_COMPANION_EXECUTION_SIGNER_PUBLIC_KEY_SPKI;
    const signerDigest =
      context.trustedSignerPublicKeySpkiSha256 ??
      PRODUCTION_COMPANION_EXECUTION_SIGNER_PUBLIC_KEY_SPKI_SHA256;
    const spki = Buffer.from(signerSpki, 'base64url');
    const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
    const canonicalSpki = key.export({ format: 'der', type: 'spki' });
    const signature = canonicalLowSSignature(candidate.signature);
    if (
      candidate.signerKeyId !== signerKeyId ||
      !signature ||
      spki.length !== 91 ||
      signerSpki !== spki.toString('base64url') ||
      !Buffer.isBuffer(canonicalSpki) ||
      !canonicalSpki.equals(spki) ||
      key.asymmetricKeyType !== 'ec' ||
      key.asymmetricKeyDetails?.namedCurve !== 'prime256v1' ||
      `sha256:${createHash('sha256').update(spki).digest('hex')}` !== signerDigest
    ) {
      return unavailable();
    }
    const transcript = Buffer.from(
      `${COMPANION_EXECUTION_HANDOFF_PURPOSE}\0${JSON.stringify(body)}`,
      'utf8',
    );
    if (!verify('sha256', transcript, { key, dsaEncoding: 'ieee-p1363' }, signature)) {
      return unavailable();
    }
    return Object.freeze({
      accountId: body.platformAgentAccountId,
      activationEpoch: body.activationEpoch,
      archiveSha256: body.companionArchiveSha256,
      installationTreeSha256: body.companionInstallationTreeSha256,
      expiresAtMs,
      requestKey: body.requestKey,
    });
  } catch {
    return unavailable();
  }
}

export async function loadWindowsCompanionExecutionHandoff(
  dataRoot: string,
  context: WindowsCompanionExecutionHandoffContext,
  installationRoot: string,
): Promise<WindowsCompanionExecutionHandoff> {
  try {
    const root = await realpath(dataRoot);
    const directory = resolve(root, 'execution-v2');
    const file = resolve(directory, HANDOFF_FILE);
    const [directoryStat, fileStat, realDirectory, realFile] = await Promise.all([
      lstat(directory),
      lstat(file),
      realpath(directory),
      realpath(file),
    ]);
    if (
      !directoryStat.isDirectory() ||
      directoryStat.isSymbolicLink() ||
      !fileStat.isFile() ||
      fileStat.isSymbolicLink() ||
      fileStat.size < 2 ||
      fileStat.size > MAX_HANDOFF_BYTES ||
      realDirectory !== directory ||
      realFile !== file
    ) {
      return unavailable();
    }
    const raw = await readFile(file, 'utf8');
    if (
      Buffer.byteLength(raw, 'utf8') !== fileStat.size ||
      raw !== JSON.stringify(JSON.parse(raw))
    ) {
      return unavailable();
    }
    const handoff = verifyWindowsCompanionExecutionHandoff(JSON.parse(raw), context);
    await verifyWindowsCompanionInstallationTree(
      installationRoot,
      context.releaseSha,
      handoff.installationTreeSha256,
    );
    return handoff;
  } catch {
    return unavailable();
  }
}
