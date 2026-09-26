import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';

import { describe, expect, it } from 'vitest';

import {
  deliverCompanionLaunchProof,
  takeCompanionLaunchProofRequest,
} from './launch-proof-channel.js';

const challenge = randomBytes(32).toString('base64url');
const pipePath = `\\\\.\\pipe\\fetanagent-companion-launch-${randomBytes(16).toString('hex')}`;

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
        const proof = { body: { sample: true }, signature: 'a' } as never;
        await deliverCompanionLaunchProof({ challenge, pipePath }, proof);
        await complete;
        expect(received).toBe(`${JSON.stringify(proof)}\n`);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );
});
