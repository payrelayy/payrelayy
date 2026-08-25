import { describe, expect, it } from 'vitest';

import {
  createKemerBetReadinessControllerIsolatedNetworkRevalidator,
  createKemerBetReadinessFixedIsolatedNetworkRevalidator,
  isUsableKemerBetReadinessDefaultRouteFlags,
  KemerBetReadinessNetworkGateUnavailableError,
  parseKemerBetReadinessProcDefaultRouteInterfaces,
  type KemerBetReadinessNetworkTopology,
} from './kemerbet-readiness-network-gate.js';

function topology(
  interfaces: readonly string[],
  defaults: readonly string[] = [],
): KemerBetReadinessNetworkTopology {
  return {
    defaultRouteInterfaceNames: defaults,
    nonLoopbackInterfaceNames: interfaces,
  };
}

describe('KemerBet readiness static network boundaries', () => {
  it('parses only usable IPv4 and IPv6 default routes', () => {
    const parsed = parseKemerBetReadinessProcDefaultRouteInterfaces({
      ipv4Routes: [
        'Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT',
        'eth1 00000000 00000000 0001 0 0 0 00000000 0 0 0',
        'eth2 00000000 00000000 0201 0 0 0 00000000 0 0 0',
      ].join('\n'),
      ipv6Routes:
        '00000000000000000000000000000000 00 00000000000000000000000000000000 00 00000000000000000000000000000000 00000000 00000000 00000000 00000001 eth3',
    });

    expect(parsed).toEqual(['eth1', 'eth3']);
    expect(isUsableKemerBetReadinessDefaultRouteFlags('0001')).toBe(true);
    expect(isUsableKemerBetReadinessDefaultRouteFlags('0201')).toBe(false);
  });

  it('attests one stable controller interface with zero defaults at every check', async () => {
    const observed = [topology(['rpc0']), topology(['rpc0']), topology(['rpc0'])];
    const revalidate = await createKemerBetReadinessControllerIsolatedNetworkRevalidator({
      captureNetworkTopology: async () => observed.shift()!,
    });

    await expect(revalidate()).resolves.toBeUndefined();
  });

  it('attests two stable browser interfaces with zero defaults at every check', async () => {
    const observed = [
      topology(['proxy0', 'rpc0']),
      topology(['rpc0', 'proxy0']),
      topology(['proxy0', 'rpc0']),
    ];
    const revalidate = await createKemerBetReadinessFixedIsolatedNetworkRevalidator({
      captureNetworkTopology: async () => observed.shift()!,
    });

    await expect(revalidate()).resolves.toBeUndefined();
  });

  it.each([
    ['controller has two interfaces', 'controller', topology(['rpc0', 'proxy0'])],
    ['browser has one interface', 'browser', topology(['rpc0'])],
    ['a usable default appears', 'controller', topology(['rpc0'], ['rpc0'])],
  ] as const)('rejects when %s', async (_label, kind, observed) => {
    const create =
      kind === 'controller'
        ? createKemerBetReadinessControllerIsolatedNetworkRevalidator
        : createKemerBetReadinessFixedIsolatedNetworkRevalidator;
    await expect(create({ captureNetworkTopology: async () => observed })).rejects.toBeInstanceOf(
      KemerBetReadinessNetworkGateUnavailableError,
    );
  });

  it('rejects an interface mutation during revalidation', async () => {
    const observed = [topology(['rpc0']), topology(['rpc0']), topology(['rpc1'])];
    const revalidate = await createKemerBetReadinessControllerIsolatedNetworkRevalidator({
      captureNetworkTopology: async () => observed.shift()!,
    });

    await expect(revalidate()).rejects.toBeInstanceOf(KemerBetReadinessNetworkGateUnavailableError);
  });
});
