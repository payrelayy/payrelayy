import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';

import { signCompanionExecutionLaunchProof } from '@fetanagent/agent-platform-companion-execution-contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  GuardedLocalLaunchProofUnavailableError,
  openGuardedLocalLaunchProofChannel,
  type GuardedLocalLaunchProofChannel,
} from './guarded-local-launch-channel.js';

const channels: GuardedLocalLaunchProofChannel[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(channels.splice(0).map((channel) => channel.close()));
});

function signedProof(challenge: string) {
  const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = Buffer.from(device.publicKey.export({ format: 'der', type: 'spki' }));
  const proof = signCompanionExecutionLaunchProof(
    {
      challenge,
      certificateBodyDigest: `sha256:${'a'.repeat(64)}`,
      deviceKeyId: 'test-device-key',
      devicePublicKeySpki: spki.toString('base64url'),
      releaseSha: 'b'.repeat(40),
      installationTreeSha256: `sha256:${'c'.repeat(64)}`,
      requestKey: randomUUID(),
      activationEpoch: '1',
      platformAgentAccountId: randomUUID(),
      executionHandoffSha256: `sha256:${'d'.repeat(64)}`,
      processId: 1234,
      startedAt: '2026-09-27T00:00:00.000Z',
      observedAt: '2026-09-27T00:00:01.000Z',
    },
    device.privateKey,
  );
  expect(proof).toBeDefined();
  return proof!;
}

function connectAndSend(
  pipePath: string,
  payload: string,
): { socket: Socket; closed: Promise<string> } {
  const socket = createConnection(pipePath);
  sockets.push(socket);
  let response = '';
  const closed = new Promise<string>((resolve, reject) => {
    socket.on('data', (chunk: Buffer) => {
      response += chunk.toString('utf8');
    });
    socket.once('error', reject);
    socket.once('close', () => resolve(response));
    socket.once('connect', () => socket.write(payload));
  });
  return { socket, closed };
}

describe('guarded local launch proof channel', () => {
  it('rejects invalid challenges without opening a pipe', async () => {
    await expect(openGuardedLocalLaunchProofChannel('not-a-challenge')).rejects.toBeInstanceOf(
      GuardedLocalLaunchProofUnavailableError,
    );
  });

  it.skipIf(process.platform === 'win32')('is unavailable off Windows', async () => {
    await expect(
      openGuardedLocalLaunchProofChannel(randomBytes(32).toString('base64url')),
    ).rejects.toBeInstanceOf(GuardedLocalLaunchProofUnavailableError);
  });

  it.skipIf(process.platform !== 'win32')(
    'receives one v2 proof and closes without sending any permit',
    async () => {
      const challenge = randomBytes(32).toString('base64url');
      const channel = await openGuardedLocalLaunchProofChannel(challenge);
      channels.push(channel);
      const proof = signedProof(challenge);
      const client = connectAndSend(channel.pipePath, `${JSON.stringify(proof)}\n`);
      expect(await channel.receiveProof()).toEqual(proof);
      await channel.close();
      expect(await client.closed).toBe('');
      await channel.close();
    },
  );

  it.skipIf(process.platform !== 'win32')('rejects a proof for another challenge', async () => {
    const challenge = randomBytes(32).toString('base64url');
    const channel = await openGuardedLocalLaunchProofChannel(challenge);
    channels.push(channel);
    const client = connectAndSend(
      channel.pipePath,
      `${JSON.stringify(signedProof(randomBytes(32).toString('base64url')))}\n`,
    );
    await expect(channel.receiveProof()).rejects.toBeInstanceOf(
      GuardedLocalLaunchProofUnavailableError,
    );
    expect(await client.closed).toBe('');
  });

  it.skipIf(process.platform !== 'win32')('rejects oversized input', async () => {
    const channel = await openGuardedLocalLaunchProofChannel(randomBytes(32).toString('base64url'));
    channels.push(channel);
    const client = connectAndSend(channel.pipePath, `${'A'.repeat(2_049)}\n`);
    await expect(channel.receiveProof()).rejects.toBeInstanceOf(
      GuardedLocalLaunchProofUnavailableError,
    );
    expect(await client.closed).toBe('');
  });

  it.skipIf(process.platform !== 'win32')('aborts and rejects a pending receive', async () => {
    const channel = await openGuardedLocalLaunchProofChannel(randomBytes(32).toString('base64url'));
    channels.push(channel);
    const abort = new AbortController();
    const pending = channel.receiveProof(abort.signal);
    abort.abort();
    await expect(pending).rejects.toBeInstanceOf(GuardedLocalLaunchProofUnavailableError);
    await channel.close();
  });

  it.skipIf(process.platform !== 'win32')('does not accept a second client', async () => {
    const challenge = randomBytes(32).toString('base64url');
    const channel = await openGuardedLocalLaunchProofChannel(challenge);
    channels.push(channel);
    const proof = signedProof(challenge);
    const first = connectAndSend(channel.pipePath, `${JSON.stringify(proof)}\n`);
    expect(await channel.receiveProof()).toEqual(proof);
    const second = connectAndSend(channel.pipePath, `${JSON.stringify(proof)}\n`);
    expect(await second.closed).toBe('');
    await channel.close();
    expect(await first.closed).toBe('');
    expect(channel.pipePath).toMatch(/^\\\\\.\\pipe\\fetanagent-companion-launch-[0-9a-f]{32}$/u);
    expect(proof.body.challengeDigest).toBe(
      `sha256:${createHash('sha256').update(Buffer.from(challenge, 'base64url')).digest('hex')}`,
    );
  });
});
