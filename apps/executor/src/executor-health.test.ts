import { describe, expect, it } from 'vitest';

import { createKemerBetExecutorHealth } from './executor-health.js';

const FIRST_ACCOUNT = '77777777-7777-4777-8777-777777777771';
const SECOND_ACCOUNT = '77777777-7777-4777-8777-777777777772';

describe('KemerBet executor health', () => {
  it('keeps liveness healthy while readiness requires the database and every exact session', async () => {
    const sessionProbes: string[] = [];
    let activeProbes = 0;
    let maximumActiveProbes = 0;
    const health = createKemerBetExecutorHealth({
      platformAgentAccountIds: [FIRST_ACCOUNT, SECOND_ACCOUNT],
      probeDatabase: async () => true,
      probeSessionReadiness: async (accountId) => {
        sessionProbes.push(accountId);
        activeProbes += 1;
        maximumActiveProbes = Math.max(maximumActiveProbes, activeProbes);
        await Promise.resolve();
        activeProbes -= 1;
        return { ready: true, reason: 'ready' };
      },
    });

    expect(health.healthz()).toEqual({ status: 'ok', service: 'fetanagent-executor' });
    await expect(health.readyz()).resolves.toEqual({
      ready: true,
      status: 'ready',
      service: 'fetanagent-executor',
    });
    expect(sessionProbes).toEqual([FIRST_ACCOUNT, SECOND_ACCOUNT]);
    expect(maximumActiveProbes).toBe(1);
  });

  it('serially probes every exact session even when an earlier identity probe fails', async () => {
    const sessionProbes: string[] = [];
    const health = createKemerBetExecutorHealth({
      platformAgentAccountIds: [FIRST_ACCOUNT, SECOND_ACCOUNT],
      probeDatabase: async () => true,
      probeSessionReadiness: async (accountId) => {
        sessionProbes.push(accountId);
        return accountId === FIRST_ACCOUNT
          ? { ready: false, reason: 'unsafe_profile' }
          : { ready: true, reason: 'ready' };
      },
    });

    await expect(health.readyz()).resolves.toMatchObject({
      ready: false,
      reason: 'session_unavailable',
    });
    expect(sessionProbes).toEqual([FIRST_ACCOUNT, SECOND_ACCOUNT]);
  });

  it('coalesces concurrent readyz calls into one globally serialized live-session probe', async () => {
    let releaseDatabase!: () => void;
    const databaseBlocked = new Promise<void>((resolve) => {
      releaseDatabase = resolve;
    });
    let databaseProbes = 0;
    const sessionProbes: string[] = [];
    const health = createKemerBetExecutorHealth({
      platformAgentAccountIds: [FIRST_ACCOUNT, SECOND_ACCOUNT],
      probeDatabase: async () => {
        databaseProbes += 1;
        await databaseBlocked;
        return true;
      },
      probeSessionReadiness: async (accountId) => {
        sessionProbes.push(accountId);
        return { ready: true, reason: 'ready' };
      },
    });

    const first = health.readyz();
    const second = health.readyz();
    expect(first).toBe(second);
    releaseDatabase();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ready: true, status: 'ready', service: 'fetanagent-executor' },
      { ready: true, status: 'ready', service: 'fetanagent-executor' },
    ]);
    expect(databaseProbes).toBe(1);
    expect(sessionProbes).toEqual([FIRST_ACCOUNT, SECOND_ACCOUNT]);
  });

  it('fails readiness closed without configured unique exact account IDs', async () => {
    for (const platformAgentAccountIds of [
      [],
      [FIRST_ACCOUNT, FIRST_ACCOUNT],
      ['not-an-account-id'],
    ]) {
      const health = createKemerBetExecutorHealth({
        platformAgentAccountIds,
        probeDatabase: async () => true,
        probeSessionReadiness: async () => ({ ready: true, reason: 'ready' }),
      });
      await expect(health.readyz()).resolves.toMatchObject({
        ready: false,
        reason: 'sessions_not_configured',
      });
    }
  });

  it('reports only a redacted database readiness failure and skips session probes', async () => {
    let sessionProbes = 0;
    const health = createKemerBetExecutorHealth({
      platformAgentAccountIds: [FIRST_ACCOUNT],
      probeDatabase: async () => false,
      probeSessionReadiness: async () => {
        sessionProbes += 1;
        return { ready: true, reason: 'ready' };
      },
    });

    await expect(health.readyz()).resolves.toEqual({
      ready: false,
      status: 'unavailable',
      service: 'fetanagent-executor',
      reason: 'database_unavailable',
    });
    expect(sessionProbes).toBe(0);
  });

  it('reports a redacted session failure without returning account or profile details', async () => {
    const health = createKemerBetExecutorHealth({
      platformAgentAccountIds: [FIRST_ACCOUNT],
      probeDatabase: async () => true,
      probeSessionReadiness: async () => ({ ready: false, reason: 'unsafe_profile' }),
    });

    const readiness = await health.readyz();
    expect(readiness).toEqual({
      ready: false,
      status: 'unavailable',
      service: 'fetanagent-executor',
      reason: 'session_unavailable',
    });
    expect(JSON.stringify(readiness)).not.toContain(FIRST_ACCOUNT);
    expect(JSON.stringify(readiness)).not.toContain('unsafe_profile');
  });

  it('opens the circuit monotonically while liveness remains healthy', async () => {
    let probes = 0;
    const health = createKemerBetExecutorHealth({
      platformAgentAccountIds: [FIRST_ACCOUNT],
      probeDatabase: async () => {
        probes += 1;
        return true;
      },
      probeSessionReadiness: async () => ({ ready: true, reason: 'ready' }),
    });

    health.openCircuit('needs_attention');
    health.openCircuit('cancelled_before_action');
    expect(health.circuitReason()).toBe('needs_attention');
    await expect(health.readyz()).resolves.toMatchObject({
      ready: false,
      reason: 'circuit_open',
    });
    expect(probes).toBe(0);
    expect(health.healthz().status).toBe('ok');
  });

  it('cannot report ready if the circuit opens during a live session probe', async () => {
    let releaseProbe!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    const health = createKemerBetExecutorHealth({
      platformAgentAccountIds: [FIRST_ACCOUNT],
      probeDatabase: async () => true,
      probeSessionReadiness: async () => {
        await blocked;
        return { ready: true, reason: 'ready' };
      },
    });

    const readiness = health.readyz();
    health.openCircuit('needs_attention');
    releaseProbe();
    await expect(readiness).resolves.toMatchObject({
      ready: false,
      reason: 'circuit_open',
    });
  });

  it('becomes unready before graceful shutdown', async () => {
    const health = createKemerBetExecutorHealth({
      platformAgentAccountIds: [FIRST_ACCOUNT],
      probeDatabase: async () => true,
      probeSessionReadiness: async () => ({ ready: true, reason: 'ready' }),
    });

    health.markStopping();
    await expect(health.readyz()).resolves.toMatchObject({ ready: false, reason: 'stopping' });
    expect(health.healthz().status).toBe('ok');
  });
});
