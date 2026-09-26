import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';

import { COMPANION_EXECUTION_LAUNCH_PROOF_PURPOSE } from '@fetanagent/agent-platform-companion-execution-contracts';

const PIPE_PREFIX = '\\\\.\\pipe\\fetanagent-companion-launch-';
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
const MAX_PROOF_BYTES = 2_048;
const MAX_PROOF_WAIT_MS = 90_000;
const MAX_CONNECTED_READ_MS = 10_000;

export class GuardedLocalLaunchProofUnavailableError extends Error {
  constructor() {
    super('The guarded local launch proof is unavailable.');
    this.name = 'GuardedLocalLaunchProofUnavailableError';
  }
}

export interface GuardedLocalLaunchProofChannel {
  /** Random, local-only Windows pipe path to pass to the exact child through its environment. */
  readonly pipePath: string;
  /** The signed proof still requires independent certificate, handoff, and OS-process validation. */
  receiveProof(signal?: AbortSignal): Promise<unknown>;
  /** Always closes the pipe without sending an execution permit. */
  close(): Promise<void>;
}

function canonicalChallenge(value: string): boolean {
  return (
    typeof value === 'string' &&
    CHALLENGE.test(value) &&
    Buffer.from(value, 'base64url').length === 32 &&
    Buffer.from(value, 'base64url').toString('base64url') === value
  );
}

function parseProof(line: Buffer, expectedChallengeDigest: string): unknown {
  if (line.length < 3 || line.length > MAX_PROOF_BYTES || line.at(-1) !== 10) throw new Error();
  const raw = line.subarray(0, -1).toString('utf8');
  const parsed: unknown = JSON.parse(raw);
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length !== 2 ||
    !Object.hasOwn(parsed, 'body') ||
    !Object.hasOwn(parsed, 'signature') ||
    raw !== JSON.stringify(parsed)
  ) {
    throw new Error();
  }
  const proof = parsed as Record<string, unknown>;
  const body = proof.body;
  if (
    body === null ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    (body as Record<string, unknown>).contractVersion !== 2 ||
    (body as Record<string, unknown>).purpose !== COMPANION_EXECUTION_LAUNCH_PROOF_PURPOSE ||
    (body as Record<string, unknown>).executionMode !== 'guarded' ||
    (body as Record<string, unknown>).challengeDigest !== expectedChallengeDigest ||
    typeof proof.signature !== 'string' ||
    !SIGNATURE.test(proof.signature)
  ) {
    throw new Error();
  }
  return parsed;
}

/**
 * Operator-side half of the v2 local proof exchange. This deliberately cannot
 * send the permit that would release companion workers. The caller must pass the
 * result to the independently trusted guarded-process observer, then close it.
 */
export async function openGuardedLocalLaunchProofChannel(
  challenge: string,
): Promise<GuardedLocalLaunchProofChannel> {
  if (process.platform !== 'win32' || !canonicalChallenge(challenge)) {
    throw new GuardedLocalLaunchProofUnavailableError();
  }
  const expectedChallengeDigest = `sha256:${createHash('sha256').update(Buffer.from(challenge, 'base64url')).digest('hex')}`;
  const pipePath = `${PIPE_PREFIX}${randomBytes(16).toString('hex')}`;
  let socket: Socket | undefined;
  let accepted = false;
  let settled = false;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let waitTimer: NodeJS.Timeout | undefined;
  let readTimer: NodeJS.Timeout | undefined;
  let resolveProof!: (proof: unknown) => void;
  let rejectProof!: (error: GuardedLocalLaunchProofUnavailableError) => void;
  const proofPromise = new Promise<unknown>((resolve, reject) => {
    resolveProof = resolve;
    rejectProof = reject;
  });
  // The caller may still be starting its child when a connection fails.
  void proofPromise.catch(() => undefined);

  const server: Server = createServer((candidate) => {
    if (accepted || closed) {
      candidate.destroy();
      return;
    }
    accepted = true;
    socket = candidate;
    clearTimeout(waitTimer);
    readTimer = setTimeout(fail, MAX_CONNECTED_READ_MS);
    const chunks: Buffer[] = [];
    let size = 0;
    candidate.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_PROOF_BYTES) {
        fail();
        return;
      }
      chunks.push(chunk);
      const bytes = Buffer.concat(chunks, size);
      const newline = bytes.indexOf(10);
      if (newline < 0) return;
      if (newline !== bytes.length - 1) {
        fail();
        return;
      }
      try {
        const proof = parseProof(bytes, expectedChallengeDigest);
        settled = true;
        clearTimeout(readTimer);
        resolveProof(proof);
      } catch {
        fail();
      }
    });
    candidate.once('error', fail);
    candidate.once('end', fail);
    candidate.once('close', fail);
  });
  function fail(): void {
    if (settled) return;
    settled = true;
    clearTimeout(waitTimer);
    clearTimeout(readTimer);
    rejectProof(new GuardedLocalLaunchProofUnavailableError());
    void close();
  }

  function close(): Promise<void> {
    if (closePromise) return closePromise;
    closed = true;
    clearTimeout(waitTimer);
    clearTimeout(readTimer);
    if (!settled) {
      settled = true;
      rejectProof(new GuardedLocalLaunchProofUnavailableError());
    }
    socket?.destroy();
    closePromise = new Promise<void>((resolve) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
    return closePromise;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(pipePath, () => {
        server.off('error', reject);
        resolve();
      });
    });
    server.once('error', fail);
    waitTimer = setTimeout(fail, MAX_PROOF_WAIT_MS);
  } catch {
    await close();
    throw new GuardedLocalLaunchProofUnavailableError();
  }

  return Object.freeze({
    pipePath,
    async receiveProof(signal?: AbortSignal): Promise<unknown> {
      if (signal?.aborted) {
        await close();
        throw new GuardedLocalLaunchProofUnavailableError();
      }
      const abort = () => {
        void close();
      };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      try {
        return await proofPromise;
      } finally {
        signal?.removeEventListener('abort', abort);
      }
    },
    close,
  });
}
