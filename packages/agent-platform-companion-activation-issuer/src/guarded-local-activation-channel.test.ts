import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';

import { signCompanionExecutionLaunchProof } from '@fetanagent/agent-platform-companion-execution-contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GuardedLocalActivationUnavailableError,
  GuardedLocalActivationUncertainError,
  openGuardedLocalActivationChannel,
  type GuardedLocalActivationChannel,
} from './guarded-local-activation-channel.js';

const channels: GuardedLocalActivationChannel[] = [];
const sockets: Socket[] = [];
const stopOnUncertainty = vi.fn(async () =>
  Object.freeze({
    databaseCredentialsAndSessionsRevoked: true as const,
    financialAuthorityDisabled: true as const,
    companionExecutionDisabled: true as const,
    exactHostStopped: true as const,
    providerOutcomeRequiresReconciliation: true as const,
  }),
);
const independentStop = () => ({
  confirmReady: vi.fn(async () => undefined),
  lost: new Promise<never>(() => undefined),
});
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(channels.splice(0).map((channel) => channel.close()));
  stopOnUncertainty.mockClear();
});

function fixture(challenge: string) {
  const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = Buffer.from(device.publicKey.export({ format: 'der', type: 'spki' }));
  const requestKey = randomUUID();
  const actorAuthUserId = randomUUID();
  const proof = signCompanionExecutionLaunchProof(
    {
      challenge,
      certificateBodyDigest: `sha256:${'a'.repeat(64)}`,
      deviceKeyId: 'test-device-key',
      devicePublicKeySpki: spki.toString('base64url'),
      releaseSha: 'b'.repeat(40),
      installationTreeSha256: `sha256:${'c'.repeat(64)}`,
      requestKey,
      activationEpoch: '1',
      platformAgentAccountId: randomUUID(),
      executionHandoffSha256: `sha256:${'d'.repeat(64)}`,
      processId: 1234,
      startedAt: new Date(Date.now() - 1000).toISOString(),
      observedAt: new Date().toISOString(),
    },
    device.privateKey,
  );
  expect(proof).toBeDefined();
  const proofDigest = `sha256:${createHash('sha256').update(JSON.stringify(proof)).digest('hex')}`;
  return { proof: proof!, proofDigest, requestKey, actorAuthUserId };
}

function client(
  pipePath: string,
  proof: unknown,
  acknowledge: 'correct' | 'incorrect' | 'none' = 'correct',
) {
  const socket = createConnection(pipePath);
  sockets.push(socket);
  let permit = '';
  const receivedPermit = new Promise<string>((resolve) => {
    socket.on('data', (chunk: Buffer) => {
      permit += chunk.toString('utf8');
      if (permit.endsWith('\n')) {
        resolve(permit);
        if (acknowledge === 'correct') {
          socket.write(permit.replace('PERMIT_V2', 'ACK_V2'));
        } else if (acknowledge === 'incorrect') {
          socket.write('FETANAGENT_GUARDED_LAUNCH_ACK_V2|wrong\n');
        }
      }
    });
  });
  socket.once('connect', () => socket.write(`${JSON.stringify(proof)}\n`));
  return { socket, receivedPermit, getPermit: () => permit };
}

describe('internal guarded local activation channel', () => {
  it('rejects invalid challenges before opening a pipe', async () => {
    await expect(openGuardedLocalActivationChannel('invalid')).rejects.toBeInstanceOf(
      GuardedLocalActivationUnavailableError,
    );
  });

  it.skipIf(process.platform !== 'win32')(
    'sends one proof-bound permit only after the retained digest and one-use transition agree, then requires ACK',
    async () => {
      const challenge = randomBytes(32).toString('base64url');
      const channel = await openGuardedLocalActivationChannel(challenge);
      channels.push(channel);
      const f = fixture(challenge);
      const peer = client(channel.pipePath, f.proof);
      expect(await channel.receiveProof()).toEqual(f.proof);
      let releaseTransition!: (value: Date) => void;
      let transitionStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        transitionStarted = resolve;
      });
      const transition = new Promise<Date>((resolve) => {
        releaseTransition = resolve;
      });
      const query = vi.fn(async (sql: string, values: unknown[]) => {
        if (sql.includes('launch_proof_digest::text')) {
          expect(values).toEqual([f.requestKey]);
          return { rows: [{ proof_digest: f.proofDigest }] };
        }
        expect(sql).toContain('activate_agent_platform_companion_execution_once');
        expect(values).toEqual([f.actorAuthUserId, f.requestKey, 'e'.repeat(64)]);
        transitionStarted();
        return { rows: [{ valid_until: await transition }] };
      });
      const pending = channel.commitAndPermit({
        actorAuthUserId: f.actorAuthUserId,
        requestKey: f.requestKey,
        verifiedProofDigest: f.proofDigest,
        runtimePassword: 'e'.repeat(64),
        administrator: { query },
        trustedNow: () => new Date(),
        stopOnUncertainty,
        independentStop: independentStop(),
      });
      await started;
      expect(peer.getPermit()).toBe('');
      const validUntil = new Date(Date.now() + 30 * 60_000).toISOString();
      releaseTransition(new Date(validUntil));
      const permit = await peer.receivedPermit;
      expect(permit).toBe(`FETANAGENT_GUARDED_LAUNCH_PERMIT_V2|${f.proofDigest}|${validUntil}\n`);
      await expect(pending).resolves.toMatchObject({
        permitAcknowledged: true,
        runtimeConfirmationRequired: true,
      });
      expect(query).toHaveBeenCalledTimes(2);
      expect(stopOnUncertainty).not.toHaveBeenCalled();
      await expect(channel.commitAndPermit({} as never)).rejects.toBeInstanceOf(
        GuardedLocalActivationUnavailableError,
      );
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'never transitions or permits a proof missing its matching retained attestation',
    async () => {
      const challenge = randomBytes(32).toString('base64url');
      const channel = await openGuardedLocalActivationChannel(challenge);
      channels.push(channel);
      const f = fixture(challenge);
      const peer = client(channel.pipePath, f.proof);
      await channel.receiveProof();
      const query = vi.fn(async () => ({ rows: [{ proof_digest: `sha256:${'f'.repeat(64)}` }] }));
      await expect(
        channel.commitAndPermit({
          actorAuthUserId: f.actorAuthUserId,
          requestKey: f.requestKey,
          verifiedProofDigest: f.proofDigest,
          runtimePassword: 'e'.repeat(64),
          administrator: { query },
          trustedNow: () => new Date(),
          stopOnUncertainty,
          independentStop: independentStop(),
        }),
      ).rejects.toBeInstanceOf(GuardedLocalActivationUnavailableError);
      expect(query).toHaveBeenCalledTimes(1);
      expect(stopOnUncertainty).not.toHaveBeenCalled();
      expect(peer.getPermit()).toBe('');
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'treats a failed transition as uncertain and sends no permit',
    async () => {
      const challenge = randomBytes(32).toString('base64url');
      const channel = await openGuardedLocalActivationChannel(challenge);
      channels.push(channel);
      const f = fixture(challenge);
      const peer = client(channel.pipePath, f.proof);
      await channel.receiveProof();
      const query = vi.fn(async (sql: string) => {
        if (sql.includes('launch_proof_digest::text')) {
          return { rows: [{ proof_digest: f.proofDigest }] };
        }
        throw new Error('sensitive database response');
      });
      await expect(
        channel.commitAndPermit({
          actorAuthUserId: f.actorAuthUserId,
          requestKey: f.requestKey,
          verifiedProofDigest: f.proofDigest,
          runtimePassword: 'e'.repeat(64),
          administrator: { query },
          trustedNow: () => new Date(),
          stopOnUncertainty,
          independentStop: independentStop(),
        }),
      ).rejects.toMatchObject({
        name: 'GuardedLocalActivationUncertainError',
        requiresIndependentStopAndReconciliation: true,
      });
      expect(query).toHaveBeenCalledTimes(2);
      expect(stopOnUncertainty).toHaveBeenCalledTimes(1);
      expect(peer.getPermit()).toBe('');
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'does not report permit delivery when the companion ACK is invalid',
    async () => {
      const challenge = randomBytes(32).toString('base64url');
      const channel = await openGuardedLocalActivationChannel(challenge);
      channels.push(channel);
      const f = fixture(challenge);
      const peer = client(channel.pipePath, f.proof, 'incorrect');
      await channel.receiveProof();
      const query = vi.fn(async (sql: string) =>
        sql.includes('launch_proof_digest::text')
          ? { rows: [{ proof_digest: f.proofDigest }] }
          : { rows: [{ valid_until: new Date(Date.now() + 30 * 60_000) }] },
      );
      const pending = channel.commitAndPermit({
        actorAuthUserId: f.actorAuthUserId,
        requestKey: f.requestKey,
        verifiedProofDigest: f.proofDigest,
        runtimePassword: 'e'.repeat(64),
        administrator: { query },
        trustedNow: () => new Date(),
        stopOnUncertainty,
        independentStop: independentStop(),
      });
      await peer.receivedPermit;
      await expect(pending).rejects.toBeInstanceOf(GuardedLocalActivationUncertainError);
      expect(query).toHaveBeenCalledTimes(2);
      expect(stopOnUncertainty).toHaveBeenCalledTimes(1);
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'refuses to dispatch a transition without a bound independent stop',
    async () => {
      const challenge = randomBytes(32).toString('base64url');
      const channel = await openGuardedLocalActivationChannel(challenge);
      channels.push(channel);
      const f = fixture(challenge);
      const peer = client(channel.pipePath, f.proof);
      await channel.receiveProof();
      const query = vi.fn(async () => ({ rows: [{ proof_digest: f.proofDigest }] }));
      await expect(
        channel.commitAndPermit({
          actorAuthUserId: f.actorAuthUserId,
          requestKey: f.requestKey,
          verifiedProofDigest: f.proofDigest,
          runtimePassword: 'e'.repeat(64),
          administrator: { query },
          trustedNow: () => new Date(),
          stopOnUncertainty: undefined as never,
          independentStop: independentStop(),
        }),
      ).rejects.toBeInstanceOf(GuardedLocalActivationUnavailableError);
      expect(query).not.toHaveBeenCalled();
      expect(peer.getPermit()).toBe('');
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'refuses the transition when no separately owned stop supervisor is bound',
    async () => {
      const challenge = randomBytes(32).toString('base64url');
      const channel = await openGuardedLocalActivationChannel(challenge);
      channels.push(channel);
      const f = fixture(challenge);
      const peer = client(channel.pipePath, f.proof);
      await channel.receiveProof();
      const query = vi.fn(async () => ({ rows: [{ proof_digest: f.proofDigest }] }));
      await expect(
        channel.commitAndPermit({
          actorAuthUserId: f.actorAuthUserId,
          requestKey: f.requestKey,
          verifiedProofDigest: f.proofDigest,
          runtimePassword: 'e'.repeat(64),
          administrator: { query },
          trustedNow: () => new Date(),
          stopOnUncertainty,
          independentStop: undefined as never,
        }),
      ).rejects.toBeInstanceOf(GuardedLocalActivationUnavailableError);
      expect(query).not.toHaveBeenCalled();
      expect(peer.getPermit()).toBe('');
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'does not read attestation or transition when the separate supervisor is not ready',
    async () => {
      const challenge = randomBytes(32).toString('base64url');
      const channel = await openGuardedLocalActivationChannel(challenge);
      channels.push(channel);
      const f = fixture(challenge);
      const peer = client(channel.pipePath, f.proof);
      await channel.receiveProof();
      const query = vi.fn(async () => ({ rows: [{ proof_digest: f.proofDigest }] }));
      await expect(
        channel.commitAndPermit({
          actorAuthUserId: f.actorAuthUserId,
          requestKey: f.requestKey,
          verifiedProofDigest: f.proofDigest,
          runtimePassword: 'e'.repeat(64),
          administrator: { query },
          trustedNow: () => new Date(),
          stopOnUncertainty,
          independentStop: {
            confirmReady: async () => {
              throw new Error('private supervisor detail');
            },
            lost: new Promise<never>(() => undefined),
          },
        }),
      ).rejects.toBeInstanceOf(GuardedLocalActivationUnavailableError);
      expect(query).not.toHaveBeenCalled();
      expect(stopOnUncertainty).not.toHaveBeenCalled();
      expect(peer.getPermit()).toBe('');
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'stops once without a permit if the separate supervisor is lost during transition',
    async () => {
      const challenge = randomBytes(32).toString('base64url');
      const channel = await openGuardedLocalActivationChannel(challenge);
      channels.push(channel);
      const f = fixture(challenge);
      const peer = client(channel.pipePath, f.proof);
      await channel.receiveProof();
      let lose!: () => void;
      const lost = new Promise<void>((resolve) => {
        lose = resolve;
      });
      let transitionStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        transitionStarted = resolve;
      });
      const query = vi.fn(async (sql: string) => {
        if (sql.includes('launch_proof_digest::text')) {
          return { rows: [{ proof_digest: f.proofDigest }] };
        }
        transitionStarted();
        return new Promise<{ rows: { valid_until: Date }[] }>(() => undefined);
      });
      const pending = channel.commitAndPermit({
        actorAuthUserId: f.actorAuthUserId,
        requestKey: f.requestKey,
        verifiedProofDigest: f.proofDigest,
        runtimePassword: 'e'.repeat(64),
        administrator: { query },
        trustedNow: () => new Date(),
        stopOnUncertainty,
        independentStop: { confirmReady: async () => undefined, lost },
      });
      await started;
      lose();
      await expect(pending).rejects.toBeInstanceOf(GuardedLocalActivationUncertainError);
      expect(query).toHaveBeenCalledTimes(2);
      expect(stopOnUncertainty).toHaveBeenCalledTimes(1);
      expect(peer.getPermit()).toBe('');
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'invokes the bound stop if the separate supervisor is lost after permit acknowledgement',
    async () => {
      const challenge = randomBytes(32).toString('base64url');
      const channel = await openGuardedLocalActivationChannel(challenge);
      channels.push(channel);
      const f = fixture(challenge);
      const peer = client(channel.pipePath, f.proof);
      await channel.receiveProof();
      let lose!: () => void;
      const lost = new Promise<void>((resolve) => {
        lose = resolve;
      });
      const query = vi.fn(async (sql: string) =>
        sql.includes('launch_proof_digest::text')
          ? { rows: [{ proof_digest: f.proofDigest }] }
          : { rows: [{ valid_until: new Date(Date.now() + 30 * 60_000) }] },
      );
      const result = await channel.commitAndPermit({
        actorAuthUserId: f.actorAuthUserId,
        requestKey: f.requestKey,
        verifiedProofDigest: f.proofDigest,
        runtimePassword: 'e'.repeat(64),
        administrator: { query },
        trustedNow: () => new Date(),
        stopOnUncertainty,
        independentStop: { confirmReady: async () => undefined, lost },
      });
      expect(result.permitAcknowledged).toBe(true);
      expect(peer.getPermit()).toContain('FETANAGENT_GUARDED_LAUNCH_PERMIT_V2');
      expect(stopOnUncertainty).not.toHaveBeenCalled();
      lose();
      await expect(result.independentStopLoss).rejects.toBeInstanceOf(
        GuardedLocalActivationUncertainError,
      );
      await vi.waitFor(() => expect(stopOnUncertainty).toHaveBeenCalledTimes(1));
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'still fails closed when the independent stop itself cannot be confirmed',
    async () => {
      const challenge = randomBytes(32).toString('base64url');
      const channel = await openGuardedLocalActivationChannel(challenge);
      channels.push(channel);
      const f = fixture(challenge);
      const peer = client(channel.pipePath, f.proof);
      await channel.receiveProof();
      const query = vi.fn(async (sql: string) => {
        if (sql.includes('launch_proof_digest::text')) {
          return { rows: [{ proof_digest: f.proofDigest }] };
        }
        throw new Error('do not expose database details');
      });
      const failedStop = vi.fn(async () => {
        throw new Error('do not expose stop details');
      });
      await expect(
        channel.commitAndPermit({
          actorAuthUserId: f.actorAuthUserId,
          requestKey: f.requestKey,
          verifiedProofDigest: f.proofDigest,
          runtimePassword: 'e'.repeat(64),
          administrator: { query },
          trustedNow: () => new Date(),
          stopOnUncertainty: failedStop,
          independentStop: independentStop(),
        }),
      ).rejects.toBeInstanceOf(GuardedLocalActivationUncertainError);
      expect(query).toHaveBeenCalledTimes(2);
      expect(failedStop).toHaveBeenCalledTimes(1);
      expect(peer.getPermit()).toBe('');
    },
  );
});
