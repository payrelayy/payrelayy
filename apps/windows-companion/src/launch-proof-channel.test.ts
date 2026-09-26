import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';

import { describe, expect, it } from 'vitest';

import {
  COMPANION_EXECUTION_LAUNCH_PROOF_PURPOSE,
  COMPANION_LAUNCH_PROOF_PURPOSE,
} from '@fetanagent/agent-platform-companion-execution-contracts';

import {
  deliverCompanionExecutionLaunchProofAndAwaitPermit,
  deliverCompanionLaunchProof,
  takeCompanionLaunchProofRequest,
} from './launch-proof-channel.js';

const challenge = randomBytes(32).toString('base64url');
const pipePath = `\\\\.\\pipe\\fetanagent-companion-launch-${randomBytes(16).toString('hex')}`;
const challengeDigest = `sha256:${createHash('sha256').update(Buffer.from(challenge, 'base64url')).digest('hex')}`;
const guardedProof = {
  body: {
    contractVersion: 2,
    purpose: COMPANION_EXECUTION_LAUNCH_PROOF_PURPOSE,
    executionMode: 'guarded',
    challengeDigest,
  },
  signature: 'test-only',
} as never;

describe('local companion launch-proof channel', () => {
  it('accepts only an exact local named pipe and erases the inherited challenge', () => {
    const environment = {
      FETANAGENT_COMPANION_LAUNCH_CHALLENGE: challenge,
      FETANAGENT_COMPANION_LAUNCH_PIPE: pipePath,
    };
    expect(takeCompanionLaunchProofRequest(environment)).toEqual({ challenge, pipePath });
    expect(environment).toEqual({});
    for (const changedPipe of [
      'https://example.invalid/collect',
      '\\\\.\\pipe\\another-name',
      `${pipePath}\\more`,
    ]) {
      expect(() =>
        takeCompanionLaunchProofRequest({
          FETANAGENT_COMPANION_LAUNCH_CHALLENGE: challenge,
          FETANAGENT_COMPANION_LAUNCH_PIPE: changedPipe,
        }),
      ).toThrow();
    }
    expect(() =>
      takeCompanionLaunchProofRequest({ FETANAGENT_COMPANION_LAUNCH_PIPE: pipePath }),
    ).toThrow();
    expect(takeCompanionLaunchProofRequest({})).toBeUndefined();
    expect(() => takeCompanionLaunchProofRequest({}, true)).toThrow(
      'A protected local launch channel is required for guarded execution.',
    );
    const invalidEnvironment = {
      FETANAGENT_COMPANION_LAUNCH_CHALLENGE: challenge,
      FETANAGENT_COMPANION_LAUNCH_PIPE: 'https://example.invalid/collect',
    };
    expect(() => takeCompanionLaunchProofRequest(invalidEnvironment, true)).toThrow();
    expect(invalidEnvironment).toEqual({});
  });

  it('keeps diagnostic and guarded proof purposes separate before opening a pipe', async () => {
    await expect(
      deliverCompanionLaunchProof({ challenge, pipePath }, guardedProof),
    ).rejects.toThrow('The local companion launch proof is invalid.');
    await expect(
      deliverCompanionExecutionLaunchProofAndAwaitPermit(
        { challenge: randomBytes(32).toString('base64url'), pipePath },
        guardedProof,
      ),
    ).rejects.toThrow('The guarded local launch proof is invalid.');
  });

  it.skipIf(process.platform !== 'win32')(
    'delivers one proof only over the local pipe',
    async () => {
      const server = createServer();
      let received = '';
      const complete = new Promise<void>((resolve) => {
        server.once('connection', (socket) => {
          socket.on('data', (chunk) => {
            received += chunk.toString('utf8');
          });
          socket.once('end', () => resolve());
        });
      });
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(pipePath, resolve);
      });
      try {
        const proof = {
          body: {
            contractVersion: 1,
            purpose: COMPANION_LAUNCH_PROOF_PURPOSE,
            challengeDigest,
          },
          signature: 'test-only',
        } as never;
        await deliverCompanionLaunchProof({ challenge, pipePath }, proof);
        await complete;
        expect(received).toBe(`${JSON.stringify(proof)}\n`);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'holds guarded execution until the local pipe returns a proof-bound permit',
    async () => {
      const server = createServer((socket) => {
        let received = '';
        socket.on('data', (chunk) => {
          received += chunk.toString('utf8');
          if (received.endsWith('\n')) {
            const proofBytes = received.slice(0, -1);
            const digest = createHash('sha256').update(proofBytes, 'utf8').digest('hex');
            socket.write(`FETANAGENT_GUARDED_LAUNCH_PERMIT_V1|sha256:${digest}\n`);
          }
        });
      });
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(pipePath, resolve);
      });
      try {
        await expect(
          deliverCompanionExecutionLaunchProofAndAwaitPermit({ challenge, pipePath }, guardedProof),
        ).resolves.toBeUndefined();
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'rejects an incorrect permit without releasing guarded execution',
    async () => {
      const server = createServer((socket) => {
        socket.once('data', () => socket.end('FETANAGENT_GUARDED_LAUNCH_PERMIT_V1|wrong\n'));
      });
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(pipePath, resolve);
      });
      try {
        await expect(
          deliverCompanionExecutionLaunchProofAndAwaitPermit({ challenge, pipePath }, guardedProof),
        ).rejects.toThrow('The guarded local launch permit is unavailable.');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'rejects when the companion session aborts before a permit arrives',
    async () => {
      const controller = new AbortController();
      const server = createServer((socket) => {
        socket.once('data', () => controller.abort());
      });
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(pipePath, resolve);
      });
      try {
        await expect(
          deliverCompanionExecutionLaunchProofAndAwaitPermit(
            { challenge, pipePath },
            guardedProof,
            controller.signal,
          ),
        ).rejects.toThrow('The guarded local launch permit is unavailable.');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );
});
