import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';

import {
  COMPANION_EXECUTION_LAUNCH_PROOF_PURPOSE,
  COMPANION_LAUNCH_PROOF_PURPOSE,
  type SignedCompanionExecutionLaunchProof,
  type SignedCompanionLaunchProof,
} from '@fetanagent/agent-platform-companion-execution-contracts';

const PIPE_PREFIX = '\\\\.\\pipe\\fetanagent-companion-launch-';
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/u;
const PIPE_SUFFIX = /^[0-9a-f]{32}$/u;
const GUARDED_PERMIT_PREFIX = 'FETANAGENT_GUARDED_LAUNCH_PERMIT_V1|';
const MAX_PROOF_BYTES = 2_048;
const MAX_PERMIT_BYTES = 128;
const MAX_PERMIT_WAIT_MS = 2 * 60_000;

export interface CompanionLaunchProofRequest {
  readonly challenge: string;
  readonly pipePath: string;
}

function validRequest(request: CompanionLaunchProofRequest): boolean {
  return (
    typeof request.challenge === 'string' &&
    CHALLENGE.test(request.challenge) &&
    Buffer.from(request.challenge, 'base64url').length === 32 &&
    Buffer.from(request.challenge, 'base64url').toString('base64url') === request.challenge &&
    typeof request.pipePath === 'string' &&
    request.pipePath.startsWith(PIPE_PREFIX) &&
    PIPE_SUFFIX.test(request.pipePath.slice(PIPE_PREFIX.length))
  );
}

/** A challenge is useful only to the launcher that created this local pipe. */
export function takeCompanionLaunchProofRequest(
  environment: NodeJS.ProcessEnv = process.env,
  requiredForGuardedExecution = false,
): CompanionLaunchProofRequest | undefined {
  const challenge = environment.FETANAGENT_COMPANION_LAUNCH_CHALLENGE;
  const pipePath = environment.FETANAGENT_COMPANION_LAUNCH_PIPE;
  delete environment.FETANAGENT_COMPANION_LAUNCH_CHALLENGE;
  delete environment.FETANAGENT_COMPANION_LAUNCH_PIPE;
  if (challenge === undefined && pipePath === undefined) {
    if (requiredForGuardedExecution) {
      throw new Error('A protected local launch channel is required for guarded execution.');
    }
    return undefined;
  }
  const request = { challenge, pipePath } as CompanionLaunchProofRequest;
  if (!validRequest(request)) {
    throw new Error('The local companion launch challenge is invalid.');
  }
  return Object.freeze(request);
}

/** Never writes this proof to stdout, a file, a remote endpoint, or a process argument. */
export async function deliverCompanionLaunchProof(
  request: CompanionLaunchProofRequest,
  proof: SignedCompanionLaunchProof,
): Promise<void> {
  if (
    !validRequest(request) ||
    proof?.body?.contractVersion !== 1 ||
    proof.body.purpose !== COMPANION_LAUNCH_PROOF_PURPOSE ||
    proof.body.challengeDigest !==
      `sha256:${createHash('sha256').update(Buffer.from(request.challenge, 'base64url')).digest('hex')}`
  ) {
    throw new Error('The local companion launch proof is invalid.');
  }
  const payload = `${JSON.stringify(proof)}\n`;
  if (Buffer.byteLength(payload, 'utf8') > MAX_PROOF_BYTES) {
    throw new Error('The local companion launch proof is too large.');
  }
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection(request.pipePath);
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(new Error('The local companion launch proof could not be delivered.'));
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error('timeout')), 5_000);
    socket.once('error', (error) => finish(error));
    socket.once('connect', () => socket.end(payload, () => finish()));
  });
}

/**
 * Guarded execution stays paused after the v2 proof. Only a future protected
 * launcher may release it, after independent observation and the one-use
 * database transition. A permit is not itself financial authority.
 */
export async function deliverCompanionExecutionLaunchProofAndAwaitPermit(
  request: CompanionLaunchProofRequest,
  proof: SignedCompanionExecutionLaunchProof,
  signal?: AbortSignal,
): Promise<void> {
  if (
    !validRequest(request) ||
    proof?.body?.contractVersion !== 2 ||
    proof.body.purpose !== COMPANION_EXECUTION_LAUNCH_PROOF_PURPOSE ||
    proof.body.executionMode !== 'guarded' ||
    proof.body.challengeDigest !==
      `sha256:${createHash('sha256').update(Buffer.from(request.challenge, 'base64url')).digest('hex')}`
  ) {
    throw new Error('The guarded local launch proof is invalid.');
  }
  const serialized = JSON.stringify(proof);
  const payload = `${serialized}\n`;
  if (Buffer.byteLength(payload, 'utf8') > MAX_PROOF_BYTES) {
    throw new Error('The guarded local launch proof is too large.');
  }
  const expectedPermit = `${GUARDED_PERMIT_PREFIX}sha256:${createHash('sha256').update(serialized, 'utf8').digest('hex')}\n`;
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection(request.pipePath);
    let settled = false;
    let received = '';
    const abort = () => finish(new Error('aborted'));
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      socket.destroy();
      if (error) reject(new Error('The guarded local launch permit is unavailable.'));
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error('timeout')), MAX_PERMIT_WAIT_MS);
    if (signal?.aborted) {
      finish(new Error('aborted'));
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      finish(new Error('aborted'));
      return;
    }
    socket.once('error', (error) => finish(error));
    socket.once('end', () => finish(new Error('closed')));
    socket.once('close', () => finish(new Error('closed')));
    socket.once('connect', () => {
      if (!settled) socket.write(payload);
    });
    socket.on('data', (chunk: Buffer) => {
      if (settled) return;
      received += chunk.toString('utf8');
      if (Buffer.byteLength(received, 'utf8') > MAX_PERMIT_BYTES) {
        finish(new Error('oversized response'));
      } else if (received.includes('\n')) {
        finish(received === expectedPermit ? undefined : new Error('invalid permit'));
      }
    });
  });
}
