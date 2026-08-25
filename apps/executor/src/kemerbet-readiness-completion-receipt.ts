import { constants } from 'node:fs';
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises';

const PROXY_USER_ID = 10003;
const OUTPUT_ROOT = '/run/output';
const OUTPUT_FILE = `${OUTPUT_ROOT}/completion-receipt`;
const INSTALLING_FILE = `${OUTPUT_ROOT}/.completion-receipt.installing`;
const RECEIPT_CONTRACT = 'fetanagent-kemerbet-readiness-layer7-completion-v2';
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const RELEASE_SHA_PATTERN = /^[0-9a-f]{40}$/u;

interface ReceiptStat {
  readonly dev: number | bigint;
  readonly gid: number;
  readonly ino: number | bigint;
  readonly mode: number;
  readonly nlink: number;
  readonly size: number;
  readonly uid: number;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface KemerBetReadinessCompletionReceiptInput {
  readonly agentIdentityBindingSha256: string;
  readonly releaseSha: string;
  readonly runNonceSha256: string;
  readonly sameAgentIdentityValidated: true;
  readonly sequences: readonly number[];
}

export type KemerBetReadinessCompletionReceiptPublisher = (
  input: KemerBetReadinessCompletionReceiptInput,
) => Promise<void>;

export class KemerBetReadinessCompletionReceiptUnavailableError extends Error {
  constructor() {
    super('The KemerBet readiness completion receipt is unavailable.');
    this.name = 'KemerBetReadinessCompletionReceiptUnavailableError';
  }
}

function unavailable(): never {
  throw new KemerBetReadinessCompletionReceiptUnavailableError();
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'ENOENT'
  );
}

function sameStat(left: ReceiptStat, right: ReceiptStat): boolean {
  return (
    left.dev === right.dev &&
    left.gid === right.gid &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.uid === right.uid
  );
}

async function requireAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
    return unavailable();
  } catch (error) {
    if (!isMissing(error)) return unavailable();
  }
}

async function requireOutputDirectory(): Promise<void> {
  const before = (await lstat(OUTPUT_ROOT)) as ReceiptStat;
  if (
    !before.isDirectory() ||
    before.isSymbolicLink() ||
    before.uid !== PROXY_USER_ID ||
    before.gid !== PROXY_USER_ID ||
    (before.mode & 0o777) !== 0o700 ||
    (await realpath(OUTPUT_ROOT)) !== OUTPUT_ROOT
  ) {
    return unavailable();
  }
  if (!sameStat(before, (await lstat(OUTPUT_ROOT)) as ReceiptStat)) return unavailable();
}

export function serializeKemerBetReadinessCompletionReceipt(
  input: KemerBetReadinessCompletionReceiptInput,
): string {
  if (
    !SHA256_PATTERN.test(input.agentIdentityBindingSha256) ||
    !RELEASE_SHA_PATTERN.test(input.releaseSha) ||
    !SHA256_PATTERN.test(input.runNonceSha256) ||
    input.sameAgentIdentityValidated !== true ||
    input.sequences.length !== 5 ||
    input.sequences.some((sequence, index) => sequence !== index + 1)
  ) {
    return unavailable();
  }
  return `${JSON.stringify({
    contract: RECEIPT_CONTRACT,
    agentIdentityBindingSha256: input.agentIdentityBindingSha256,
    identifiersRedacted: true,
    moneyMoved: false,
    releaseSha: input.releaseSha,
    responsesValidated: true,
    runNonceSha256: input.runNonceSha256,
    sameAgentIdentityValidated: true,
    sequences: [1, 2, 3, 4, 5],
    transferDisabled: true,
    version: 2,
  })}\n`;
}

/** Atomically publish the one generic proxy-only receipt after all five completed responses. */
export async function publishKemerBetReadinessCompletionReceipt(
  input: KemerBetReadinessCompletionReceiptInput,
): Promise<void> {
  const serialized = serializeKemerBetReadinessCompletionReceipt(input);
  await requireOutputDirectory();
  await requireAbsent(OUTPUT_FILE);
  await requireAbsent(INSTALLING_FILE);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  let renamed = false;
  let complete = false;
  try {
    handle = await open(
      INSTALLING_FILE,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(serialized, { encoding: 'utf8' });
    await handle.sync();
    await handle.chmod(0o400);
    const written = (await handle.stat()) as ReceiptStat;
    if (
      !written.isFile() ||
      written.isSymbolicLink() ||
      written.uid !== PROXY_USER_ID ||
      written.gid !== PROXY_USER_ID ||
      (written.mode & 0o777) !== 0o400 ||
      written.nlink !== 1 ||
      written.size !== Buffer.byteLength(serialized, 'utf8')
    ) {
      return unavailable();
    }
    await handle.close();
    handle = null;
    await requireAbsent(OUTPUT_FILE);
    await rename(INSTALLING_FILE, OUTPUT_FILE);
    renamed = true;
    const installed = (await lstat(OUTPUT_FILE)) as ReceiptStat;
    if (
      !installed.isFile() ||
      installed.isSymbolicLink() ||
      installed.uid !== PROXY_USER_ID ||
      installed.gid !== PROXY_USER_ID ||
      (installed.mode & 0o777) !== 0o400 ||
      installed.nlink !== 1 ||
      installed.size !== Buffer.byteLength(serialized, 'utf8') ||
      (await realpath(OUTPUT_FILE)) !== OUTPUT_FILE
    ) {
      return unavailable();
    }
    const directory = await open(OUTPUT_ROOT, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    complete = true;
  } catch {
    return unavailable();
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(INSTALLING_FILE).catch(() => undefined);
    if (renamed && !complete) await unlink(OUTPUT_FILE).catch(() => undefined);
  }
}

export const KEMERBET_READINESS_COMPLETION_RECEIPT_CONTRACT = Object.freeze({
  contract: RECEIPT_CONTRACT,
  file: OUTPUT_FILE,
  installingFile: INSTALLING_FILE,
  mode: 0o400,
  outputRoot: OUTPUT_ROOT,
  ownerGroupId: PROXY_USER_ID,
  ownerUserId: PROXY_USER_ID,
  schema: Object.freeze({
    contract: RECEIPT_CONTRACT,
    agentIdentityBindingSha256: '<sha256-of-exact-single-line-agent-identity-binding-file>',
    identifiersRedacted: true,
    moneyMoved: false,
    releaseSha: '<reviewed-40-hex-commit>',
    responsesValidated: true,
    runNonceSha256: '<sha256-of-run-nonce>',
    sameAgentIdentityValidated: true,
    sequences: Object.freeze([1, 2, 3, 4, 5]),
    transferDisabled: true,
    version: 2,
  }),
} as const);
