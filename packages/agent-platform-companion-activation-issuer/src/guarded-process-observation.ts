import { execFile } from 'node:child_process';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  COMPANION_EXECUTION_ACTIVATION_HANDOFF_PURPOSE,
  PRODUCTION_COMPANION_EXECUTION_SIGNER_KEY_ID,
  PRODUCTION_COMPANION_EXECUTION_SIGNER_PUBLIC_KEY_SPKI,
  PRODUCTION_COMPANION_EXECUTION_SIGNER_PUBLIC_KEY_SPKI_SHA256,
  verifyCompanionExecutionLaunchProof,
  type CompanionActivationCertificateSnapshot,
  type CompanionActivationObservedProcess,
  type CompanionActivationReleaseAttestation,
  type CompanionActivationRequestSnapshot,
  type SignedCompanionExecutionLaunchProof,
} from '@fetanagent/agent-platform-companion-execution-contracts';

const execFileAsync = promisify(execFile);
const SCRIPT_FILENAME = 'inspect-guarded-windows-companion-process.ps1';
const SCRIPT_SHA256 = '82c21e0cdcc38ccde73f2897138c5577aaf7881103011e26025515976991c4e4';
const HANDOFF_FILENAME = 'activation-handoff.v1.json';
const MAX_HANDOFF_BYTES = 4_096;
const MAX_HANDOFF_LIFETIME_MS = 12 * 60 * 60_000;
const MAX_OBSERVATION_AGE_MS = 2 * 60_000;
const P256_ORDER = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const HANDOFF_KEYS = ['body', 'signerKeyId', 'signature'] as const;
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
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const OS_OUTPUT =
  /^COMPANION_GUARDED_OS_PROCESS_OBSERVED\|([1-9][0-9]*)\|(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)$/u;

export interface GuardedCompanionProcessObservationInputs {
  readonly request: CompanionActivationRequestSnapshot;
  readonly certificate: CompanionActivationCertificateSnapshot;
  readonly release: CompanionActivationReleaseAttestation;
  /** Protected operator path to the already-installed companion's data root. */
  readonly dataRoot: string;
  /** Independently measured installed release tree, not a companion claim. */
  readonly installationRoot: string;
  /** v2 proof received by a protected local challenge pipe, never a remote endpoint. */
  readonly proof: unknown;
  readonly challenge: string;
  readonly challengeIssuedAt: string;
  readonly powershellExecutable: string;
  readonly verifierScriptPath: string;
  readonly trustedNow: () => Date;
}

interface TrustedSigner {
  readonly keyId: string;
  readonly publicKeySpki: string;
  readonly publicKeySpkiSha256: string;
}

const PRODUCTION_SIGNER: TrustedSigner = {
  keyId: PRODUCTION_COMPANION_EXECUTION_SIGNER_KEY_ID,
  publicKeySpki: PRODUCTION_COMPANION_EXECUTION_SIGNER_PUBLIC_KEY_SPKI,
  publicKeySpkiSha256: PRODUCTION_COMPANION_EXECUTION_SIGNER_PUBLIC_KEY_SPKI_SHA256,
};

export class GuardedCompanionProcessObservationUnavailableError extends Error {
  constructor() {
    super('The guarded companion process observation is unavailable.');
    this.name = 'GuardedCompanionProcessObservationUnavailableError';
  }
}

type ProcessReader = (executable: string, arguments_: readonly string[]) => Promise<string>;

async function readProcess(executable: string, arguments_: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync(executable, [...arguments_], {
    encoding: 'utf8',
    maxBuffer: 512,
    timeout: 10_000,
    windowsHide: true,
  });
  return stdout;
}

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function timestamp(value: unknown): number {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) throw new Error();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error();
  return parsed;
}

function trustedTime(source: () => Date): number {
  const value = source();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error();
  return value.getTime();
}

function signedHandoffDigest(
  raw: string,
  input: GuardedCompanionProcessObservationInputs,
  signer: TrustedSigner,
  now: number,
): string {
  if (Buffer.byteLength(raw, 'utf8') < 2 || Buffer.byteLength(raw, 'utf8') > MAX_HANDOFF_BYTES)
    throw new Error();
  const parsed: unknown = JSON.parse(raw);
  if (
    !exactKeys(parsed, HANDOFF_KEYS) ||
    !exactKeys(parsed.body, BODY_KEYS) ||
    raw !== JSON.stringify(parsed)
  )
    throw new Error();
  const body = parsed.body;
  const issuedAt = timestamp(body.issuedAt);
  const notBefore = timestamp(body.notBefore);
  const expiresAt = timestamp(body.expiresAt);
  if (
    body.contractVersion !== 1 ||
    body.purpose !== COMPANION_EXECUTION_ACTIVATION_HANDOFF_PURPOSE ||
    body.deploymentTarget !== 'production' ||
    body.requestKey !== input.request.requestKey ||
    body.activationEpoch !== input.request.activationEpoch ||
    body.platformAgentAccountId !== input.request.platformAgentAccountId ||
    body.noMoneyCertificateBodyDigest !== input.certificate.certificateBodyDigest ||
    body.companionReleaseSha !== input.request.companionReleaseSha ||
    body.companionArchiveSha256 !== input.request.companionArchiveSha256 ||
    body.companionInstallationTreeSha256 !== input.request.companionInstallationTreeSha256 ||
    body.companionReleaseSha !== input.release.releaseSha ||
    body.companionArchiveSha256 !== input.release.archiveSha256 ||
    body.companionInstallationTreeSha256 !== input.release.installationTreeSha256 ||
    issuedAt > notBefore ||
    expiresAt <= notBefore ||
    expiresAt > issuedAt + MAX_HANDOFF_LIFETIME_MS ||
    now < notBefore ||
    now >= expiresAt ||
    now >= timestamp(input.request.expiresAt) ||
    parsed.signerKeyId !== signer.keyId ||
    typeof parsed.signature !== 'string' ||
    !/^[A-Za-z0-9_-]{86}$/u.test(parsed.signature)
  )
    throw new Error();

  const signature = Buffer.from(parsed.signature, 'base64url');
  const spki = Buffer.from(signer.publicKeySpki, 'base64url');
  if (
    signature.length !== 64 ||
    signature.toString('base64url') !== parsed.signature ||
    spki.length !== 91 ||
    spki.toString('base64url') !== signer.publicKeySpki ||
    `sha256:${createHash('sha256').update(spki).digest('hex')}` !== signer.publicKeySpkiSha256
  )
    throw new Error();
  const r = BigInt(`0x${signature.subarray(0, 32).toString('hex')}`);
  const s = BigInt(`0x${signature.subarray(32).toString('hex')}`);
  if (r <= 0n || r >= P256_ORDER || s <= 0n || s > P256_ORDER / 2n) throw new Error();
  const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
  const canonical = key.export({ format: 'der', type: 'spki' });
  if (
    key.asymmetricKeyType !== 'ec' ||
    key.asymmetricKeyDetails?.namedCurve !== 'prime256v1' ||
    !Buffer.isBuffer(canonical) ||
    !canonical.equals(spki) ||
    !verify(
      'sha256',
      Buffer.from(
        `${COMPANION_EXECUTION_ACTIVATION_HANDOFF_PURPOSE}\0${JSON.stringify(body)}`,
        'utf8',
      ),
      { key, dsaEncoding: 'ieee-p1363' },
      signature,
    )
  )
    throw new Error();

  return `sha256:${createHash('sha256').update(raw, 'utf8').digest('hex')}`;
}

async function readCanonicalHandoff(dataRoot: string): Promise<string> {
  const root = await realpath(dataRoot);
  const directory = resolve(root, 'execution-v2');
  const file = resolve(directory, HANDOFF_FILENAME);
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
  )
    throw new Error();
  const raw = await readFile(file, 'utf8');
  if (Buffer.byteLength(raw, 'utf8') !== fileStat.size) throw new Error();
  return raw;
}

/**
 * Test seam only. The package exports only the production wrapper below.
 * This verifies an existing process; it never launches one or enables execution.
 */
export async function observeGuardedWindowsCompanionProcessWithReader(
  input: GuardedCompanionProcessObservationInputs,
  read: ProcessReader,
  signer: TrustedSigner,
): Promise<CompanionActivationObservedProcess> {
  try {
    if (
      !isAbsolute(input.dataRoot) ||
      !isAbsolute(input.installationRoot) ||
      !isAbsolute(input.powershellExecutable) ||
      !isAbsolute(input.verifierScriptPath) ||
      basename(input.powershellExecutable).toLowerCase() !== 'pwsh.exe' ||
      basename(input.verifierScriptPath) !== SCRIPT_FILENAME ||
      typeof input.challenge !== 'string' ||
      Buffer.from(input.challenge, 'base64url').length !== 32 ||
      Buffer.from(input.challenge, 'base64url').toString('base64url') !== input.challenge
    )
      throw new Error();
    const challengeIssuedAt = timestamp(input.challengeIssuedAt);
    const before = trustedTime(input.trustedNow);
    if (challengeIssuedAt > before || before - challengeIssuedAt > MAX_OBSERVATION_AGE_MS)
      throw new Error();
    const stat = await lstat(input.verifierScriptPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error();
    const source = (await readFile(input.verifierScriptPath, 'utf8')).replace(/\r\n/gu, '\n');
    if (createHash('sha256').update(source).digest('hex') !== SCRIPT_SHA256) throw new Error();
    const rawHandoff = await readCanonicalHandoff(input.dataRoot);
    const handoffSha256 = signedHandoffDigest(rawHandoff, input, signer, before);
    if (
      !exactKeys(input.proof, ['body', 'signature']) ||
      !exactKeys(input.proof.body, [
        'contractVersion',
        'purpose',
        'challengeDigest',
        'certificateBodyDigest',
        'deviceKeyId',
        'releaseSha',
        'installationTreeSha256',
        'executionMode',
        'requestKey',
        'activationEpoch',
        'platformAgentAccountId',
        'executionHandoffSha256',
        'processId',
        'startedAt',
        'observedAt',
      ])
    )
      throw new Error();
    const body = input.proof.body;
    const processId = body.processId;
    if (
      !Number.isInteger(processId) ||
      (processId as number) < 1 ||
      (processId as number) > 2_147_483_647
    )
      throw new Error();
    const startedAt = timestamp(body.startedAt);
    const observedAt = timestamp(body.observedAt);
    if (
      startedAt > observedAt ||
      observedAt < challengeIssuedAt ||
      observedAt > before + 5_000 ||
      before - observedAt > MAX_OBSERVATION_AGE_MS
    )
      throw new Error();
    if (
      !verifyCompanionExecutionLaunchProof(input.proof, {
        challenge: input.challenge,
        certificateBodyDigest: input.certificate.certificateBodyDigest,
        deviceKeyId: input.certificate.deviceKeyId,
        devicePublicKeySpki: input.certificate.devicePublicKeySpki,
        releaseSha: input.release.releaseSha,
        installationTreeSha256: input.release.installationTreeSha256,
        requestKey: input.request.requestKey,
        activationEpoch: input.request.activationEpoch,
        platformAgentAccountId: input.request.platformAgentAccountId,
        executionHandoffSha256: handoffSha256,
        processId: processId as number,
        startedAt: body.startedAt as string,
        observedAt: body.observedAt as string,
      })
    )
      throw new Error();
    const nodeExecutable = resolve(input.installationRoot, 'runtime', 'node.exe');
    const entryPoint = resolve(input.installationRoot, 'app', 'dist', 'index.js');
    const osOutput = await read(input.powershellExecutable, [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      input.verifierScriptPath,
      '-CompanionProcessId',
      String(processId),
      '-NodeExecutable',
      nodeExecutable,
      '-EntryPoint',
      entryPoint,
    ]);
    const match = OS_OUTPUT.exec(osOutput.trim());
    if (
      !match ||
      Number(match[1]) !== processId ||
      Math.abs(timestamp(match[2]) - startedAt) > 5_000
    )
      throw new Error();
    const after = trustedTime(input.trustedNow);
    if (
      after < before ||
      after - challengeIssuedAt > MAX_OBSERVATION_AGE_MS ||
      after >= timestamp(input.request.expiresAt)
    )
      throw new Error();
    return Object.freeze({
      processId: processId as number,
      startedAt: body.startedAt as string,
      observedAt: body.observedAt as string,
      executionHandoffSha256: handoffSha256,
      proof: input.proof as unknown as SignedCompanionExecutionLaunchProof,
    });
  } catch {
    throw new GuardedCompanionProcessObservationUnavailableError();
  }
}

/** Requires a separately reviewed local challenge-pipe launcher and trusted operator inputs. */
export async function observeGuardedWindowsCompanionProcess(
  input: GuardedCompanionProcessObservationInputs,
): Promise<CompanionActivationObservedProcess> {
  if (process.platform !== 'win32') throw new GuardedCompanionProcessObservationUnavailableError();
  return observeGuardedWindowsCompanionProcessWithReader(input, readProcess, PRODUCTION_SIGNER);
}
