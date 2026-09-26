import { createConnection } from 'node:net';

import type { SignedCompanionLaunchProof } from './launch-proof.js';

const PIPE_PREFIX = '\\\\.\\pipe\\fetanagent-companion-launch-';
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/u;
const PIPE_SUFFIX = /^[0-9a-f]{32}$/u;

export interface CompanionLaunchProofRequest {
  readonly challenge: string;
  readonly pipePath: string;
}

/** A challenge is useful only to the launcher that created this local pipe. */
export function takeCompanionLaunchProofRequest(
  environment: NodeJS.ProcessEnv = process.env,
): CompanionLaunchProofRequest | undefined {
  const challenge = environment.FETANAGENT_COMPANION_LAUNCH_CHALLENGE;
  const pipePath = environment.FETANAGENT_COMPANION_LAUNCH_PIPE;
  delete environment.FETANAGENT_COMPANION_LAUNCH_CHALLENGE;
  delete environment.FETANAGENT_COMPANION_LAUNCH_PIPE;
  if (challenge === undefined && pipePath === undefined) return undefined;
  if (
    typeof challenge !== 'string' ||
    !CHALLENGE.test(challenge) ||
    Buffer.from(challenge, 'base64url').length !== 32 ||
    Buffer.from(challenge, 'base64url').toString('base64url') !== challenge ||
    typeof pipePath !== 'string' ||
    !pipePath.startsWith(PIPE_PREFIX) ||
    !PIPE_SUFFIX.test(pipePath.slice(PIPE_PREFIX.length))
  ) {
    throw new Error('The local companion launch challenge is invalid.');
  }
  return Object.freeze({ challenge, pipePath });
}

/** Never writes this proof to stdout, a file, a remote endpoint, or a process argument. */
export async function deliverCompanionLaunchProof(
  request: CompanionLaunchProofRequest,
  proof: SignedCompanionLaunchProof,
): Promise<void> {
  const payload = `${JSON.stringify(proof)}\n`;
  if (Buffer.byteLength(payload, 'utf8') > 2_048) {
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
