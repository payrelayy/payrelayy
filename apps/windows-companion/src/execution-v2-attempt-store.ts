import { lstat, mkdir, open, readFile, realpath, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isProxy } from 'node:util/types';

import {
  decodeSignedExecutionAssignment,
  decodeSignedExecutionEnrollment,
  decodeSignedExecutionResult,
  decodeSignedOneUseActionAuthority,
  type SignedExecutionAssignment,
  type SignedExecutionEnrollment,
  type SignedExecutionResult,
  type SignedOneUseActionAuthority,
} from '@fetanagent/agent-platform-companion-execution-contracts';

import {
  createWindowsCurrentUserDataProtector,
  type WindowsCurrentUserDataProtector,
} from './windows-data-protection.js';

const EXECUTION_DIRECTORY = 'execution-v2';
const FILES = Object.freeze({
  enrollment: 'attempt-enrollment.secure.json',
  assignment: 'attempt-assignment.secure.json',
  authority: 'attempt-authority.secure.json',
  result: 'attempt-result.secure.json',
} as const);
const MAXIMUM_CLEAR_BYTES = 3_840;
const MAXIMUM_STORED_BYTES = 8_192;

type AttemptPart = keyof typeof FILES;
type UnknownRecord = Record<string, unknown>;

export interface WindowsCompanionExecutionV2AttemptChain {
  readonly enrollment: SignedExecutionEnrollment;
  readonly assignment: SignedExecutionAssignment;
  readonly authority: SignedOneUseActionAuthority | null;
  readonly result: SignedExecutionResult | null;
}

export type WindowsCompanionExecutionV2AttemptLoadResult =
  | { readonly state: 'missing' }
  | { readonly state: 'corrupt' }
  | {
      readonly state: 'available';
      readonly chain: WindowsCompanionExecutionV2AttemptChain;
    };

export interface WindowsCompanionExecutionV2AttemptStoreOptions {
  readonly dataRoot: string;
  readonly protector?: WindowsCurrentUserDataProtector;
}

interface ProtectedAttemptPart {
  readonly envelopeVersion: 2;
  readonly protection: 'windows-dpapi-current-user';
  readonly purposeDomain: 'execution-v2-attempt-chain';
  readonly part: AttemptPart;
  readonly protectedPayloadBase64: string;
}

export class WindowsCompanionExecutionV2AttemptStoreUnavailableError extends Error {
  constructor() {
    super('Windows companion execution-v2 protected attempt state is unavailable.');
    this.name = 'WindowsCompanionExecutionV2AttemptStoreUnavailableError';
  }
}

function unavailable(): never {
  throw new WindowsCompanionExecutionV2AttemptStoreUnavailableError();
}

function plainRecord(candidate: unknown): candidate is UnknownRecord {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    !Array.isArray(candidate) &&
    !isProxy(candidate) &&
    Object.getPrototypeOf(candidate) === Object.prototype
  );
}

function exactKeys(candidate: UnknownRecord, expected: readonly string[]): boolean {
  const actual = Reflect.ownKeys(candidate);
  return (
    actual.length === expected.length &&
    actual.every((key) => typeof key === 'string' && expected.includes(key)) &&
    expected.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
    })
  );
}

function normalizePath(value: string): string {
  return process.platform === 'win32' ? value.toLocaleLowerCase('en-US') : value;
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

async function stableRoot(dataRoot: string): Promise<string> {
  const deviceRoot = resolve(dataRoot, 'device');
  const executionRoot = resolve(deviceRoot, EXECUTION_DIRECTORY);
  await mkdir(executionRoot, { recursive: true, mode: 0o700 });
  const [deviceStat, executionStat, canonicalData, canonicalDevice, canonicalExecution] =
    await Promise.all([
      lstat(deviceRoot),
      lstat(executionRoot),
      realpath(dataRoot),
      realpath(deviceRoot),
      realpath(executionRoot),
    ]);
  if (
    !deviceStat.isDirectory() ||
    deviceStat.isSymbolicLink() ||
    !executionStat.isDirectory() ||
    executionStat.isSymbolicLink() ||
    normalizePath(canonicalDevice) !== normalizePath(resolve(canonicalData, 'device')) ||
    normalizePath(canonicalExecution) !==
      normalizePath(resolve(canonicalDevice, EXECUTION_DIRECTORY))
  ) {
    unavailable();
  }
  return canonicalExecution;
}

function matchingAssignmentEnrollment(
  enrollment: SignedExecutionEnrollment,
  assignment: SignedExecutionAssignment,
): boolean {
  return (
    assignment.body.enrollmentId === enrollment.body.enrollmentId &&
    assignment.body.enrollmentBodyDigest === enrollment.bodyDigest &&
    assignment.body.noMoneyCertificateId === enrollment.body.noMoneyCertificateId &&
    assignment.body.noMoneyCertificateBodyDigest === enrollment.body.noMoneyCertificateBodyDigest &&
    assignment.body.deviceId === enrollment.body.deviceId &&
    assignment.body.deviceKeyId === enrollment.body.deviceKeyId &&
    assignment.body.executionSignerKeyId === enrollment.body.executionSignerKeyId &&
    assignment.body.platformAgentAccountId === enrollment.body.platformAgentAccountId &&
    assignment.body.pilotId === enrollment.body.pilotId &&
    assignment.body.pilotRevision === enrollment.body.pilotRevision &&
    assignment.body.pilotConfigDigest === enrollment.body.pilotConfigDigest
  );
}

function matchingAuthorityAssignment(
  assignment: SignedExecutionAssignment,
  authority: SignedOneUseActionAuthority,
): boolean {
  return (
    authority.body.assignmentId === assignment.body.assignmentId &&
    authority.body.assignmentBodyDigest === assignment.bodyDigest &&
    authority.body.attemptId === assignment.body.attemptId &&
    authority.body.deviceId === assignment.body.deviceId &&
    authority.body.deviceKeyId === assignment.body.deviceKeyId &&
    authority.body.playerIdDigest === assignment.body.playerIdDigest
  );
}

function matchingResult(
  assignment: SignedExecutionAssignment,
  authority: SignedOneUseActionAuthority,
  result: SignedExecutionResult,
): boolean {
  return (
    result.body.assignmentId === assignment.body.assignmentId &&
    result.body.assignmentBodyDigest === assignment.bodyDigest &&
    result.body.authorityId === authority.body.authorityId &&
    result.body.authorityBodyDigest === authority.bodyDigest &&
    result.body.attemptId === assignment.body.attemptId &&
    result.body.deviceId === assignment.body.deviceId &&
    result.body.deviceKeyId === assignment.body.deviceKeyId &&
    result.body.fenceId === authority.body.fenceId
  );
}

function decodeChain(
  enrollmentCandidate: unknown,
  assignmentCandidate: unknown,
  authorityCandidate: unknown | null,
  resultCandidate: unknown | null,
): WindowsCompanionExecutionV2AttemptChain | undefined {
  const enrollment = decodeSignedExecutionEnrollment(enrollmentCandidate);
  const assignment = decodeSignedExecutionAssignment(assignmentCandidate);
  const authority =
    authorityCandidate === null ? null : decodeSignedOneUseActionAuthority(authorityCandidate);
  const result = resultCandidate === null ? null : decodeSignedExecutionResult(resultCandidate);
  if (
    !enrollment ||
    !assignment ||
    !matchingAssignmentEnrollment(enrollment, assignment) ||
    (authorityCandidate !== null && !authority) ||
    (resultCandidate !== null && !result) ||
    (authority && !matchingAuthorityAssignment(assignment, authority)) ||
    (result && (!authority || !matchingResult(assignment, authority, result)))
  ) {
    return undefined;
  }
  return Object.freeze({
    enrollment,
    assignment,
    authority: authority ?? null,
    result: result ?? null,
  });
}

function protectorFor(
  options: WindowsCompanionExecutionV2AttemptStoreOptions,
): WindowsCurrentUserDataProtector {
  return (
    options.protector ??
    createWindowsCurrentUserDataProtector(process.env, 'execution-v2-attempt-chain')
  );
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    const stat = await lstat(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size < 1 ||
      stat.size > MAXIMUM_STORED_BYTES
    ) {
      unavailable();
    }
    return await readFile(path, 'utf8');
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return undefined;
    throw error;
  }
}

async function readPart(
  root: string,
  part: AttemptPart,
  protector: WindowsCurrentUserDataProtector,
): Promise<unknown | undefined> {
  const raw = await readOptional(resolve(root, FILES[part]));
  if (raw === undefined) return undefined;
  let envelope: unknown;
  try {
    envelope = JSON.parse(raw) as unknown;
  } catch {
    return unavailable();
  }
  if (
    !plainRecord(envelope) ||
    !exactKeys(envelope, [
      'envelopeVersion',
      'protection',
      'purposeDomain',
      'part',
      'protectedPayloadBase64',
    ]) ||
    envelope.envelopeVersion !== 2 ||
    envelope.protection !== 'windows-dpapi-current-user' ||
    envelope.purposeDomain !== 'execution-v2-attempt-chain' ||
    envelope.part !== part ||
    typeof envelope.protectedPayloadBase64 !== 'string' ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      envelope.protectedPayloadBase64,
    )
  ) {
    return unavailable();
  }
  const protectedBytes = Buffer.from(envelope.protectedPayloadBase64, 'base64');
  let clear: Buffer | undefined;
  try {
    if (
      protectedBytes.length < 1 ||
      protectedBytes.length > MAXIMUM_STORED_BYTES ||
      protectedBytes.toString('base64') !== envelope.protectedPayloadBase64
    ) {
      unavailable();
    }
    clear = await protector.unprotect(protectedBytes);
    if (clear.length < 1 || clear.length > MAXIMUM_CLEAR_BYTES) unavailable();
    const payload = JSON.parse(clear.toString('utf8')) as unknown;
    if (
      !plainRecord(payload) ||
      !exactKeys(payload, ['attemptChainVersion', 'part', 'value']) ||
      payload.attemptChainVersion !== 2 ||
      payload.part !== part
    ) {
      unavailable();
    }
    return payload.value;
  } catch (error) {
    if (error instanceof WindowsCompanionExecutionV2AttemptStoreUnavailableError) throw error;
    return unavailable();
  } finally {
    protectedBytes.fill(0);
    clear?.fill(0);
  }
}

async function writePart(
  root: string,
  part: AttemptPart,
  value: unknown,
  protector: WindowsCurrentUserDataProtector,
): Promise<void> {
  const clear = Buffer.from(JSON.stringify({ attemptChainVersion: 2, part, value }), 'utf8');
  let protectedBytes: Buffer | undefined;
  let handle;
  try {
    if (clear.length < 1 || clear.length > MAXIMUM_CLEAR_BYTES) unavailable();
    protectedBytes = await protector.protect(clear);
    if (protectedBytes.length < 1 || protectedBytes.length > MAXIMUM_STORED_BYTES) unavailable();
    const envelope: ProtectedAttemptPart = Object.freeze({
      envelopeVersion: 2,
      protection: 'windows-dpapi-current-user',
      purposeDomain: 'execution-v2-attempt-chain',
      part,
      protectedPayloadBase64: protectedBytes.toString('base64'),
    });
    const serialized = `${JSON.stringify(envelope)}\n`;
    if (Buffer.byteLength(serialized) > MAXIMUM_STORED_BYTES) unavailable();
    handle = await open(resolve(root, FILES[part]), 'wx', 0o600);
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
  } catch (error) {
    if (error instanceof WindowsCompanionExecutionV2AttemptStoreUnavailableError) throw error;
    return unavailable();
  } finally {
    clear.fill(0);
    protectedBytes?.fill(0);
    await handle?.close().catch(() => undefined);
  }
}

export async function loadWindowsCompanionExecutionV2AttemptChain(
  options: WindowsCompanionExecutionV2AttemptStoreOptions,
): Promise<WindowsCompanionExecutionV2AttemptLoadResult> {
  try {
    const root = await stableRoot(options.dataRoot);
    const protector = protectorFor(options);
    const [enrollment, assignment, authority, result] = await Promise.all([
      readPart(root, 'enrollment', protector),
      readPart(root, 'assignment', protector),
      readPart(root, 'authority', protector),
      readPart(root, 'result', protector),
    ]);
    if (
      enrollment === undefined &&
      assignment === undefined &&
      authority === undefined &&
      result === undefined
    ) {
      return Object.freeze({ state: 'missing' });
    }
    if (
      enrollment === undefined ||
      assignment === undefined ||
      (result !== undefined && authority === undefined)
    ) {
      return Object.freeze({ state: 'corrupt' });
    }
    const chain = decodeChain(enrollment, assignment, authority ?? null, result ?? null);
    return chain
      ? Object.freeze({ state: 'available', chain })
      : Object.freeze({ state: 'corrupt' });
  } catch {
    return Object.freeze({ state: 'corrupt' });
  }
}

export async function persistWindowsCompanionExecutionV2InitialAttemptChain(
  enrollmentCandidate: unknown,
  assignmentCandidate: unknown,
  options: WindowsCompanionExecutionV2AttemptStoreOptions,
): Promise<WindowsCompanionExecutionV2AttemptChain> {
  const chain = decodeChain(enrollmentCandidate, assignmentCandidate, null, null);
  if (!chain) unavailable();
  const current = await loadWindowsCompanionExecutionV2AttemptChain(options);
  if (current.state !== 'missing') unavailable();
  const root = await stableRoot(options.dataRoot);
  const protector = protectorFor(options);
  await writePart(root, 'enrollment', chain.enrollment, protector);
  await writePart(root, 'assignment', chain.assignment, protector);
  return chain;
}

export async function persistWindowsCompanionExecutionV2AttemptAuthority(
  previousCandidate: WindowsCompanionExecutionV2AttemptChain,
  authorityCandidate: unknown,
  options: WindowsCompanionExecutionV2AttemptStoreOptions,
): Promise<WindowsCompanionExecutionV2AttemptChain> {
  const authority = decodeSignedOneUseActionAuthority(authorityCandidate);
  const previous = decodeChain(
    previousCandidate.enrollment,
    previousCandidate.assignment,
    previousCandidate.authority,
    previousCandidate.result,
  );
  if (!previous || previous.authority !== null || previous.result !== null || !authority)
    unavailable();
  const next = decodeChain(previous.enrollment, previous.assignment, authority, null);
  const current = await loadWindowsCompanionExecutionV2AttemptChain(options);
  if (
    !next ||
    current.state !== 'available' ||
    JSON.stringify(current.chain) !== JSON.stringify(previous)
  ) {
    unavailable();
  }
  await writePart(
    await stableRoot(options.dataRoot),
    'authority',
    authority,
    protectorFor(options),
  );
  return next;
}

export async function persistWindowsCompanionExecutionV2AttemptResult(
  previousCandidate: WindowsCompanionExecutionV2AttemptChain,
  resultCandidate: unknown,
  options: WindowsCompanionExecutionV2AttemptStoreOptions,
): Promise<WindowsCompanionExecutionV2AttemptChain> {
  const result = decodeSignedExecutionResult(resultCandidate);
  const previous = decodeChain(
    previousCandidate.enrollment,
    previousCandidate.assignment,
    previousCandidate.authority,
    previousCandidate.result,
  );
  if (!previous || !previous.authority || previous.result !== null || !result) unavailable();
  const next = decodeChain(previous.enrollment, previous.assignment, previous.authority, result);
  const current = await loadWindowsCompanionExecutionV2AttemptChain(options);
  if (
    !next ||
    current.state !== 'available' ||
    JSON.stringify(current.chain) !== JSON.stringify(previous)
  ) {
    unavailable();
  }
  await writePart(await stableRoot(options.dataRoot), 'result', result, protectorFor(options));
  return next;
}

async function clearExactChain(
  expected: WindowsCompanionExecutionV2AttemptChain,
  options: WindowsCompanionExecutionV2AttemptStoreOptions,
): Promise<void> {
  const current = await loadWindowsCompanionExecutionV2AttemptChain(options);
  if (current.state !== 'available' || JSON.stringify(current.chain) !== JSON.stringify(expected)) {
    unavailable();
  }
  const root = await stableRoot(options.dataRoot);
  const parts: AttemptPart[] = ['result', 'authority', 'assignment', 'enrollment'];
  for (const part of parts) await rm(resolve(root, FILES[part]), { force: true });
}

export async function clearWindowsCompanionExecutionV2PreFenceAttemptChain(
  expected: WindowsCompanionExecutionV2AttemptChain,
  options: WindowsCompanionExecutionV2AttemptStoreOptions,
): Promise<void> {
  if (expected.authority !== null || expected.result !== null) unavailable();
  await clearExactChain(expected, options);
}

export async function clearWindowsCompanionExecutionV2TerminalAttemptChain(
  expected: WindowsCompanionExecutionV2AttemptChain,
  options: WindowsCompanionExecutionV2AttemptStoreOptions,
): Promise<void> {
  if (expected.authority === null || expected.result === null) unavailable();
  await clearExactChain(expected, options);
}
