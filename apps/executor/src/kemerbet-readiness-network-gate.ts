import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';

export interface KemerBetReadinessNetworkTopology {
  readonly defaultRouteInterfaceNames: readonly string[];
  readonly nonLoopbackInterfaceNames: readonly string[];
}

export type KemerBetReadinessNetworkRevalidator = () => Promise<void>;

export class KemerBetReadinessNetworkGateUnavailableError extends Error {
  constructor() {
    super('The KemerBet readiness network boundary is unavailable.');
    this.name = 'KemerBetReadinessNetworkGateUnavailableError';
  }
}

function unavailable(): never {
  throw new KemerBetReadinessNetworkGateUnavailableError();
}

const INTERFACE_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,32}$/u;
const ROUTE_FLAGS_PATTERN = /^(?:[0-9A-Fa-f]{4}|[0-9A-Fa-f]{8})$/u;

export function isUsableKemerBetReadinessDefaultRouteFlags(value: string): boolean {
  if (!ROUTE_FLAGS_PATTERN.test(value)) return false;
  const flags = Number.parseInt(value, 16);
  return (flags & 0x1) !== 0 && (flags & 0x200) === 0;
}

function normalizedInterfaceNames(values: readonly string[]): readonly string[] {
  const result = [...values].sort();
  if (
    result.some((value) => !INTERFACE_NAME_PATTERN.test(value)) ||
    new Set(result).size !== result.length
  ) {
    unavailable();
  }
  return Object.freeze(result);
}

export function parseKemerBetReadinessProcDefaultRouteInterfaces(input: {
  readonly ipv4Routes: string;
  readonly ipv6Routes: string;
}): readonly string[] {
  const ipv4Defaults = input.ipv4Routes
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/u))
    .filter(
      (fields) =>
        fields.length >= 8 &&
        fields[1] === '00000000' &&
        fields[7] === '00000000' &&
        isUsableKemerBetReadinessDefaultRouteFlags(fields[3] ?? ''),
    )
    .map((fields) => fields[0] ?? '');
  const ipv6Defaults = input.ipv6Routes
    .split('\n')
    .map((line) => line.trim().split(/\s+/u))
    .filter(
      (fields) =>
        fields.length >= 10 &&
        fields[0] === '00000000000000000000000000000000' &&
        fields[1] === '00' &&
        isUsableKemerBetReadinessDefaultRouteFlags(fields[8] ?? ''),
    )
    .map((fields) => fields.at(-1) ?? '');
  return normalizedInterfaceNames([...new Set([...ipv4Defaults, ...ipv6Defaults])]);
}

export async function captureProductionKemerBetReadinessNetworkTopology(): Promise<KemerBetReadinessNetworkTopology> {
  const readNonLoopbackInterfaceNames = () =>
    normalizedInterfaceNames(
      Object.entries(networkInterfaces())
        .filter(([, addresses]) => addresses?.some((address) => !address.internal) === true)
        .map(([name]) => name),
    );
  const before = readNonLoopbackInterfaceNames();
  const [ipv4Routes, ipv6Routes] = await Promise.all([
    readFile('/proc/self/net/route', 'utf8'),
    readFile('/proc/self/net/ipv6_route', 'utf8'),
  ]);
  const after = readNonLoopbackInterfaceNames();
  if (before.length !== after.length || before.some((name, index) => name !== after[index])) {
    unavailable();
  }
  return Object.freeze({
    defaultRouteInterfaceNames: parseKemerBetReadinessProcDefaultRouteInterfaces({
      ipv4Routes,
      ipv6Routes,
    }),
    nonLoopbackInterfaceNames: after,
  });
}

async function captureNormalizedNetworkTopology(
  capture: () => Promise<KemerBetReadinessNetworkTopology>,
): Promise<KemerBetReadinessNetworkTopology> {
  try {
    const topology = await capture();
    if (
      typeof topology !== 'object' ||
      topology === null ||
      !Array.isArray(topology.defaultRouteInterfaceNames) ||
      !Array.isArray(topology.nonLoopbackInterfaceNames)
    ) {
      unavailable();
    }
    return Object.freeze({
      defaultRouteInterfaceNames: normalizedInterfaceNames(topology.defaultRouteInterfaceNames),
      nonLoopbackInterfaceNames: normalizedInterfaceNames(topology.nonLoopbackInterfaceNames),
    });
  } catch {
    return unavailable();
  }
}

async function createFixedZeroDefaultRouteRevalidator(options: {
  readonly captureNetworkTopology?: () => Promise<KemerBetReadinessNetworkTopology>;
  readonly exactInterfaceCount: 1 | 2;
}): Promise<KemerBetReadinessNetworkRevalidator> {
  const capture =
    options.captureNetworkTopology ?? captureProductionKemerBetReadinessNetworkTopology;
  const initial = await captureNormalizedNetworkTopology(capture);
  if (
    initial.nonLoopbackInterfaceNames.length !== options.exactInterfaceCount ||
    initial.defaultRouteInterfaceNames.length !== 0
  ) {
    unavailable();
  }
  const expectedInterfaces = initial.nonLoopbackInterfaceNames;
  const revalidate = async (): Promise<void> => {
    const current = await captureNormalizedNetworkTopology(capture);
    if (
      current.defaultRouteInterfaceNames.length !== 0 ||
      current.nonLoopbackInterfaceNames.length !== expectedInterfaces.length ||
      current.nonLoopbackInterfaceNames.some((name, index) => name !== expectedInterfaces[index])
    ) {
      unavailable();
    }
  };
  await revalidate();
  return revalidate;
}

/** Attest the controller's one stable internal RPC network and absence of usable default routes. */
export async function createKemerBetReadinessControllerIsolatedNetworkRevalidator(
  options: {
    readonly captureNetworkTopology?: () => Promise<KemerBetReadinessNetworkTopology>;
  } = {},
): Promise<KemerBetReadinessNetworkRevalidator> {
  return createFixedZeroDefaultRouteRevalidator({ ...options, exactInterfaceCount: 1 });
}

/** Attest the browser's two stable internal networks and absence of usable default routes. */
export async function createKemerBetReadinessFixedIsolatedNetworkRevalidator(
  options: {
    readonly captureNetworkTopology?: () => Promise<KemerBetReadinessNetworkTopology>;
  } = {},
): Promise<KemerBetReadinessNetworkRevalidator> {
  return createFixedZeroDefaultRouteRevalidator({ ...options, exactInterfaceCount: 2 });
}

export const KEMERBET_READINESS_STATIC_NETWORK_CONTRACT = Object.freeze({
  browserInterfaceCount: 2,
  controllerInterfaceCount: 1,
  usableDefaultRouteCount: 0,
});
