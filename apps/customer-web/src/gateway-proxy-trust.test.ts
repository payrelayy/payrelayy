import { Resolver } from 'node:dns/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createGatewayProxyTrust, isGatewayProxyTrust } from './gateway-proxy-trust.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('fixed internal gateway proxy trust', () => {
  it('allows an absent DNS address family but fails closed on a family transport failure', async () => {
    const resolve4 = vi.spyOn(Resolver.prototype, 'resolve4').mockResolvedValue(['172.26.0.4']);
    const resolve6 = vi
      .spyOn(Resolver.prototype, 'resolve6')
      .mockRejectedValueOnce(Object.assign(new Error('no IPv6 record'), { code: 'ENODATA' }))
      .mockRejectedValueOnce(Object.assign(new Error('DNS unavailable'), { code: 'ETIMEOUT' }));
    const trust = createGatewayProxyTrust();
    await trust.refresh();
    expect(resolve4).toHaveBeenCalledWith('gateway');
    expect(resolve6).toHaveBeenCalledWith('gateway');
    expect(trust.trustProxy('172.26.0.4', 0)).toBe(true);
    await trust.refresh();
    expect(trust.trustProxy('172.26.0.4', 0)).toBe(false);
    trust.close();
  });

  it('starts with no trust and never accepts arbitrary objects or callbacks', () => {
    const trust = createGatewayProxyTrust();
    expect(isGatewayProxyTrust(trust)).toBe(true);
    expect(isGatewayProxyTrust({ ...trust })).toBe(false);
    expect(isGatewayProxyTrust({ trustProxy: () => true })).toBe(false);
    expect(isGatewayProxyTrust(true)).toBe(false);
    expect(Object.isFrozen(trust)).toBe(true);
    expect(trust.trustProxy('172.26.0.4', 0)).toBe(false);
    trust.close();
  });

  it('resolves only gateway and trusts only exact canonical IPs at the connecting hop', async () => {
    const resolveAddresses = vi.fn(async () => ['172.26.0.4', 'fdfe:628:7be8:5::4']);
    const trust = createGatewayProxyTrust({ resolveAddresses });
    await trust.refresh();
    expect(resolveAddresses).toHaveBeenCalledWith('gateway', expect.any(AbortSignal));
    for (const address of ['172.26.0.4', '::ffff:172.26.0.4', '::ffff:ac1a:4']) {
      expect(trust.trustProxy(address, 0)).toBe(true);
      expect(trust.trustProxy(address, 1)).toBe(false);
    }
    expect(trust.trustProxy('FDFE:0628:7BE8:0005:0000:0000:0000:0004', 0)).toBe(true);
    for (const address of ['172.26.0.5', '127.0.0.1', '203.0.113.1', 'fdfe:628:7be8:5::5']) {
      expect(trust.trustProxy(address, 0)).toBe(false);
    }
    trust.close();
  });

  it('normalizes IPv4-mapped DNS results back to the same exact IPv4 address', async () => {
    const trust = createGatewayProxyTrust({ resolveAddresses: async () => ['::ffff:ac1a:4'] });
    await trust.refresh();
    expect(trust.trustProxy('172.26.0.4', 0)).toBe(true);
    expect(trust.trustProxy('172.26.0.5', 0)).toBe(false);
    trust.close();
  });

  it.each(
    [
      [],
      ['172.26.0.4', 'gateway'],
      ['172.26.0.0/16'],
      ['::/0'],
      ['fe80::4%eth0'],
      ['172.026.0.4'],
      ['172.26.0.4:3003'],
      Array.from({ length: 17 }, () => '172.26.0.4'),
    ].map((snapshot) => ({ snapshot })),
  )('rejects an empty, invalid, or unbounded DNS snapshot: $snapshot', async ({ snapshot }) => {
    const trust = createGatewayProxyTrust({ resolveAddresses: async () => snapshot });
    await trust.refresh();
    expect(trust.trustProxy('172.26.0.4', 0)).toBe(false);
    trust.close();
  });

  it('drops old IPs on rotation and all trust immediately after a DNS failure', async () => {
    const resolveAddresses = vi
      .fn()
      .mockResolvedValueOnce(['172.26.0.4'])
      .mockResolvedValueOnce(['172.26.0.8'])
      .mockRejectedValueOnce(new Error('lookup unavailable'))
      .mockResolvedValueOnce(['172.26.0.9']);
    const trust = createGatewayProxyTrust({ resolveAddresses });
    await trust.refresh();
    expect(trust.trustProxy('172.26.0.4', 0)).toBe(true);
    await trust.refresh();
    expect(trust.trustProxy('172.26.0.4', 0)).toBe(false);
    expect(trust.trustProxy('172.26.0.8', 0)).toBe(true);
    await trust.refresh();
    expect(trust.trustProxy('172.26.0.8', 0)).toBe(false);
    await trust.refresh();
    expect(trust.trustProxy('172.26.0.9', 0)).toBe(true);
    trust.close();
  });

  it('rejects stale snapshots and backwards or invalid time readings', async () => {
    let now = 10_000;
    const trust = createGatewayProxyTrust({
      now: () => now,
      resolveAddresses: async () => ['172.26.0.4'],
    });
    await trust.refresh();
    now = 24_999;
    expect(trust.trustProxy('172.26.0.4', 0)).toBe(true);
    now = 25_000;
    expect(trust.trustProxy('172.26.0.4', 0)).toBe(false);
    now = 9_999;
    expect(trust.trustProxy('172.26.0.4', 0)).toBe(false);
    now = Number.NaN;
    expect(trust.trustProxy('172.26.0.4', 0)).toBe(false);
    trust.close();
  });

  it('bounds and deduplicates a stalled lookup and never accepts its late response', async () => {
    vi.useFakeTimers();
    let complete!: (addresses: string[]) => void;
    const resolveAddresses = vi.fn(
      async (_hostname: 'gateway', _signal: AbortSignal) =>
        new Promise<string[]>((resolve) => {
          complete = resolve;
        }),
    );
    const trust = createGatewayProxyTrust({ resolveAddresses });
    const first = trust.refresh();
    expect(trust.refresh()).toBe(first);
    await vi.advanceTimersByTimeAsync(1_000);
    await first;
    expect(resolveAddresses).toHaveBeenCalledTimes(1);
    expect(resolveAddresses.mock.calls[0]![1].aborted).toBe(true);
    complete(['172.26.0.4']);
    await Promise.resolve();
    expect(trust.trustProxy('172.26.0.4', 0)).toBe(false);
    trust.close();
  });

  it('starts without awaiting DNS, retries every five seconds, and stops on close', async () => {
    vi.useFakeTimers();
    const resolveAddresses = vi
      .fn()
      .mockRejectedValueOnce(new Error('gateway has not started'))
      .mockResolvedValue(['172.26.0.4']);
    const trust = createGatewayProxyTrust({ resolveAddresses });
    expect(trust.start()).toBeUndefined();
    trust.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(resolveAddresses).toHaveBeenCalledTimes(1);
    expect(trust.trustProxy('172.26.0.4', 0)).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(resolveAddresses).toHaveBeenCalledTimes(2);
    expect(trust.trustProxy('172.26.0.4', 0)).toBe(true);
    trust.close();
    trust.start();
    await trust.refresh();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(resolveAddresses).toHaveBeenCalledTimes(2);
    expect(trust.trustProxy('172.26.0.4', 0)).toBe(false);
  });

  it('cancels a pending lookup on close and cannot restore trust from a late result', async () => {
    let complete!: (addresses: string[]) => void;
    const trust = createGatewayProxyTrust({
      resolveAddresses: async () =>
        new Promise<string[]>((resolve) => {
          complete = resolve;
        }),
    });
    const pending = trust.refresh();
    await Promise.resolve();
    trust.close();
    await pending;
    complete(['172.26.0.4']);
    await Promise.resolve();
    expect(trust.trustProxy('172.26.0.4', 0)).toBe(false);
  });
});
