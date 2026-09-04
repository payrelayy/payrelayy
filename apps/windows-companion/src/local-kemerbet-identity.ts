import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  KEMERBET_AGENT_AUTHENTICATED_CANDIDATE_URL,
  KEMERBET_LOCAL_IDENTITY_ROOT_SELECTOR,
  KEMERBET_LOCAL_IDENTITY_SELECTOR_CONTRACT_VERSION,
  KEMERBET_LOCAL_IDENTITY_VALUE_SELECTOR,
  KEMERBET_LOCAL_SESSION_FAILURE_CAPTCHA_SELECTOR,
  KEMERBET_LOCAL_SESSION_FAILURE_SIGN_IN_FORM_SELECTOR,
} from '@fetanagent/agent-platform-kemerbet';

import {
  createWindowsCurrentUserDataProtector,
  type WindowsCurrentUserDataProtector,
} from './windows-data-protection.js';

const IDENTITY_BINDING_FILE = 'kemerbet-primary.binding.json';
const IDENTITY_FINGERPRINT_DOMAIN = 'fetanagent\0windows-companion\0kemerbet-local-identity\0v1\0';
const IDENTITY_FINGERPRINT_PATTERN = /^hmac-sha256:[0-9a-f]{64}$/u;
const MAXIMUM_BINDING_BYTES = 8_192;
const MAXIMUM_LOCATOR_CANDIDATES = 20;
const MAXIMUM_IDENTITY_BYTES = 256;

export type LocalKemerBetIdentityFailureCode =
  | 'FETANAGENT_IDENTITY_BINDING_UNAVAILABLE'
  | 'FETANAGENT_IDENTITY_CONFIRMATION_REQUIRED'
  | 'FETANAGENT_IDENTITY_MISMATCH';

export class LocalKemerBetIdentityVerificationError extends Error {
  readonly code: LocalKemerBetIdentityFailureCode;

  constructor(code: LocalKemerBetIdentityFailureCode) {
    super('The local KemerBet identity could not be verified.');
    this.name = 'LocalKemerBetIdentityVerificationError';
    this.code = code;
  }
}

export interface LocalIdentityLocator {
  count(): Promise<number>;
  innerText(): Promise<string>;
  isVisible(): Promise<boolean>;
  locator(selector: string): LocalIdentityLocator;
  nth(index: number): LocalIdentityLocator;
}

export interface LocalIdentityPage {
  locator(selector: string): LocalIdentityLocator;
  url(): string;
}

export interface VerifyLocalKemerBetIdentityOptions {
  readonly dataRoot: string;
  readonly expectedAgentIdentity?: string;
  readonly monotonicNow?: () => number;
  readonly now?: () => Date;
  readonly page: LocalIdentityPage;
  readonly pollDelay?: (milliseconds: number) => Promise<void>;
  readonly protector?: WindowsCurrentUserDataProtector;
  readonly releaseSha: string;
  readonly timeoutMs?: number;
}

export interface LocalKemerBetIdentityVerificationResult {
  readonly bindingCreated: boolean;
  readonly identityVerified: true;
  readonly identifiersRedacted: true;
  readonly transferDisabled: true;
}

interface StoredIdentityBinding {
  readonly bindingVersion: 1;
  readonly createdAt: string;
  readonly firstBoundReleaseSha: string;
  readonly identityFingerprint: string;
  readonly keyProtection: 'windows-dpapi-current-user';
  readonly protectedKeyBase64: string;
  readonly providerCode: 'kemerbet';
  readonly selectorContractVersion: typeof KEMERBET_LOCAL_IDENTITY_SELECTOR_CONTRACT_VERSION;
}

function fail(code: LocalKemerBetIdentityFailureCode): never {
  throw new LocalKemerBetIdentityVerificationError(code);
}

function exactCandidateUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const expected = new URL(KEMERBET_AGENT_AUTHENTICATED_CANDIDATE_URL);
    return (
      url.origin === expected.origin &&
      (url.pathname === '/agents' || url.pathname === '/agents/') &&
      url.search === '' &&
      url.hash === '' &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

function identityBytes(value: string): Buffer {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    fail('FETANAGENT_IDENTITY_MISMATCH');
  }
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length < 1 || bytes.length > MAXIMUM_IDENTITY_BYTES) {
    bytes.fill(0);
    fail('FETANAGENT_IDENTITY_MISMATCH');
  }
  return bytes;
}

function equalBytes(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function fingerprint(key: Buffer, identity: Buffer): string {
  if (key.length !== 32) fail('FETANAGENT_IDENTITY_BINDING_UNAVAILABLE');
  return `hmac-sha256:${createHmac('sha256', key)
    .update(IDENTITY_FINGERPRINT_DOMAIN, 'utf8')
    .update(identity)
    .digest('hex')}`;
}

async function exactlyOneVisible(
  locator: LocalIdentityLocator,
): Promise<LocalIdentityLocator | null> {
  const count = await locator.count();
  if (count < 0 || count > MAXIMUM_LOCATOR_CANDIDATES) {
    fail('FETANAGENT_IDENTITY_BINDING_UNAVAILABLE');
  }
  let visible: LocalIdentityLocator | null = null;
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (!(await candidate.isVisible())) continue;
    if (visible !== null) fail('FETANAGENT_IDENTITY_BINDING_UNAVAILABLE');
    visible = candidate;
  }
  return visible;
}

async function assertNoVisibleSessionFailure(page: LocalIdentityPage): Promise<void> {
  for (const selector of [
    KEMERBET_LOCAL_SESSION_FAILURE_CAPTCHA_SELECTOR,
    KEMERBET_LOCAL_SESSION_FAILURE_SIGN_IN_FORM_SELECTOR,
  ]) {
    const locator = page.locator(selector);
    const count = await locator.count();
    if (count < 0 || count > MAXIMUM_LOCATOR_CANDIDATES) {
      fail('FETANAGENT_IDENTITY_BINDING_UNAVAILABLE');
    }
    for (let index = 0; index < count; index += 1) {
      if (await locator.nth(index).isVisible()) fail('FETANAGENT_IDENTITY_MISMATCH');
    }
  }
}

async function observeIdentity(page: LocalIdentityPage): Promise<Buffer | null> {
  if (!exactCandidateUrl(page.url())) fail('FETANAGENT_IDENTITY_MISMATCH');
  await assertNoVisibleSessionFailure(page);
  const root = await exactlyOneVisible(page.locator(KEMERBET_LOCAL_IDENTITY_ROOT_SELECTOR));
  if (root === null) return null;
  const value = await exactlyOneVisible(root.locator(KEMERBET_LOCAL_IDENTITY_VALUE_SELECTOR));
  if (value === null) return null;
  const observed = identityBytes(await value.innerText());
  await assertNoVisibleSessionFailure(page);
  if (!exactCandidateUrl(page.url())) {
    observed.fill(0);
    fail('FETANAGENT_IDENTITY_MISMATCH');
  }
  return observed;
}

async function observeStableIdentity(
  page: LocalIdentityPage,
  timeoutMs: number,
  pollDelay: (milliseconds: number) => Promise<void>,
  monotonicNow: () => number,
): Promise<Buffer> {
  const deadline = monotonicNow() + timeoutMs;
  while (monotonicNow() < deadline) {
    const first = await observeIdentity(page);
    if (first !== null) {
      const second = await observeIdentity(page);
      if (second !== null) {
        if (!equalBytes(first, second)) {
          first.fill(0);
          second.fill(0);
          fail('FETANAGENT_IDENTITY_MISMATCH');
        }
        second.fill(0);
        return first;
      }
      first.fill(0);
    }
    await pollDelay(50);
  }
  fail('FETANAGENT_IDENTITY_BINDING_UNAVAILABLE');
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function parseBinding(raw: string): StoredIdentityBinding {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return fail('FETANAGENT_IDENTITY_BINDING_UNAVAILABLE');
  }
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return fail('FETANAGENT_IDENTITY_BINDING_UNAVAILABLE');
  }
  const value = candidate as Record<string, unknown>;
  if (
    !exactKeys(value, [
      'bindingVersion',
      'createdAt',
      'firstBoundReleaseSha',
      'identityFingerprint',
      'keyProtection',
      'protectedKeyBase64',
      'providerCode',
      'selectorContractVersion',
    ]) ||
    value.bindingVersion !== 1 ||
    value.providerCode !== 'kemerbet' ||
    value.selectorContractVersion !== KEMERBET_LOCAL_IDENTITY_SELECTOR_CONTRACT_VERSION ||
    value.keyProtection !== 'windows-dpapi-current-user' ||
    typeof value.createdAt !== 'string' ||
    new Date(value.createdAt).toISOString() !== value.createdAt ||
    typeof value.firstBoundReleaseSha !== 'string' ||
    !/^(?:[0-9a-f]{40}|local-development)$/u.test(value.firstBoundReleaseSha) ||
    typeof value.identityFingerprint !== 'string' ||
    !IDENTITY_FINGERPRINT_PATTERN.test(value.identityFingerprint) ||
    typeof value.protectedKeyBase64 !== 'string' ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(value.protectedKeyBase64) ||
    value.protectedKeyBase64.length > 5_464
  ) {
    return fail('FETANAGENT_IDENTITY_BINDING_UNAVAILABLE');
  }
  const protectedKey = Buffer.from(value.protectedKeyBase64, 'base64');
  const canonical = protectedKey.toString('base64') === value.protectedKeyBase64;
  protectedKey.fill(0);
  if (!canonical) fail('FETANAGENT_IDENTITY_BINDING_UNAVAILABLE');
  return Object.freeze(value as unknown as StoredIdentityBinding);
}

async function loadBinding(path: string): Promise<StoredIdentityBinding | undefined> {
  try {
    const stat = await lstat(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size < 1 ||
      stat.size > MAXIMUM_BINDING_BYTES
    ) {
      fail('FETANAGENT_IDENTITY_BINDING_UNAVAILABLE');
    }
    return parseBinding(await readFile(path, 'utf8'));
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    if (error instanceof LocalKemerBetIdentityVerificationError) throw error;
    return fail('FETANAGENT_IDENTITY_BINDING_UNAVAILABLE');
  }
}

async function writeBinding(path: string, binding: StoredIdentityBinding): Promise<void> {
  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(binding)}\n`, { encoding: 'utf8' });
    await handle.sync();
  } catch {
    fail('FETANAGENT_IDENTITY_BINDING_UNAVAILABLE');
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function verifyLocalKemerBetIdentity(
  options: VerifyLocalKemerBetIdentityOptions,
): Promise<LocalKemerBetIdentityVerificationResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    fail('FETANAGENT_IDENTITY_BINDING_UNAVAILABLE');
  }
  const identityRoot = resolve(options.dataRoot, 'identity');
  const bindingPath = resolve(identityRoot, IDENTITY_BINDING_FILE);
  await mkdir(identityRoot, { recursive: true });
  if (
    (await realpath(identityRoot)).toLocaleLowerCase('en-US') !==
    identityRoot.toLocaleLowerCase('en-US')
  ) {
    fail('FETANAGENT_IDENTITY_BINDING_UNAVAILABLE');
  }
  const protector = options.protector ?? createWindowsCurrentUserDataProtector();
  const existing = await loadBinding(bindingPath);
  if (!existing && options.expectedAgentIdentity === undefined) {
    fail('FETANAGENT_IDENTITY_CONFIRMATION_REQUIRED');
  }

  let observed: Buffer | null = null;
  let expected: Buffer | null = null;
  let clearKey: Buffer | null = null;
  let protectedKey: Buffer | null = null;
  try {
    observed = await observeStableIdentity(
      options.page,
      timeoutMs,
      options.pollDelay ??
        ((milliseconds) =>
          new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))),
      options.monotonicNow ?? (() => performance.now()),
    );
    if (options.expectedAgentIdentity !== undefined) {
      expected = identityBytes(options.expectedAgentIdentity);
      if (!equalBytes(observed, expected)) fail('FETANAGENT_IDENTITY_MISMATCH');
    }
    if (existing) {
      protectedKey = Buffer.from(existing.protectedKeyBase64, 'base64');
      clearKey = await protector.unprotect(protectedKey);
      const observedFingerprint = fingerprint(clearKey, observed);
      if (observedFingerprint !== existing.identityFingerprint) {
        fail('FETANAGENT_IDENTITY_MISMATCH');
      }
      return Object.freeze({
        bindingCreated: false,
        identityVerified: true,
        identifiersRedacted: true,
        transferDisabled: true,
      });
    }

    clearKey = randomBytes(32);
    protectedKey = await protector.protect(clearKey);
    const createdAt = (options.now ?? (() => new Date()))().toISOString();
    const binding: StoredIdentityBinding = Object.freeze({
      bindingVersion: 1,
      createdAt,
      firstBoundReleaseSha: options.releaseSha,
      identityFingerprint: fingerprint(clearKey, observed),
      keyProtection: 'windows-dpapi-current-user',
      protectedKeyBase64: protectedKey.toString('base64'),
      providerCode: 'kemerbet',
      selectorContractVersion: KEMERBET_LOCAL_IDENTITY_SELECTOR_CONTRACT_VERSION,
    });
    await writeBinding(bindingPath, binding);
    return Object.freeze({
      bindingCreated: true,
      identityVerified: true,
      identifiersRedacted: true,
      transferDisabled: true,
    });
  } finally {
    observed?.fill(0);
    expected?.fill(0);
    clearKey?.fill(0);
    protectedKey?.fill(0);
  }
}
