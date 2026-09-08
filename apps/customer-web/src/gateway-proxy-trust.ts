import { Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';

const REFRESH_INTERVAL_MS = 5_000;
const LOOKUP_TIMEOUT_MS = 1_000;
const MAX_ADDRESS_AGE_MS = 15_000;
const trustedControllers = new WeakSet<object>();

export interface GatewayProxyTrust {
  readonly trustProxy: (address: string, hop: number) => boolean;
  readonly refresh: () => Promise<void>;
  readonly start: () => void;
  readonly close: () => void;
}

interface GatewayProxyTrustDependencies {
  readonly now?: () => number;
  readonly resolveAddresses?: (
    hostname: 'gateway',
    signal: AbortSignal,
  ) => Promise<readonly string[]>;
}

function canonicalAddress(address: string): string | undefined {
  if (typeof address !== 'string' || address.length > 64 || address.includes('%')) return undefined;
  if (isIP(address) === 4) return address;
  if (isIP(address) !== 6) return undefined;
  const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(normalized);
  if (!mapped) return normalized;
  const high = Number.parseInt(mapped[1]!, 16);
  const low = Number.parseInt(mapped[2]!, 16);
  return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
}

async function resolveGatewayAddresses(
  hostname: 'gateway',
  signal: AbortSignal,
): Promise<readonly string[]> {
  const resolver = new Resolver({ timeout: LOOKUP_TIMEOUT_MS, tries: 1 });
  const cancel = () => resolver.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) throw new Error('Gateway lookup cancelled.');
    const results = await Promise.allSettled([
      resolver.resolve4(hostname),
      resolver.resolve6(hostname),
    ]);
    const addresses: string[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        addresses.push(...result.value);
      } else {
        const code = (result.reason as NodeJS.ErrnoException | undefined)?.code;
        // One family may be absent; transport failures invalidate the entire snapshot.
        if (code !== 'ENODATA' && code !== 'ENOTFOUND') {
          throw new Error('Gateway lookup unavailable.');
        }
      }
    }
    return addresses;
  } finally {
    signal.removeEventListener('abort', cancel);
    resolver.cancel();
  }
}

export function isGatewayProxyTrust(value: unknown): value is GatewayProxyTrust {
  return typeof value === 'object' && value !== null && trustedControllers.has(value);
}

/** Trust only the connecting gateway IP from a fresh internal DNS snapshot, never a hop count. */
export function createGatewayProxyTrust(
  dependencies: GatewayProxyTrustDependencies = {},
): GatewayProxyTrust {
  const now = dependencies.now ?? (() => performance.now());
  const resolveAddresses = dependencies.resolveAddresses ?? resolveGatewayAddresses;
  let addresses = new Set<string>();
  let refreshedAt = Number.NEGATIVE_INFINITY;
  let closed = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  let pending: Promise<void> | undefined;
  let activeLookup: AbortController | undefined;

  const clear = () => {
    addresses = new Set();
    refreshedAt = Number.NEGATIVE_INFINITY;
  };
  const refresh = (): Promise<void> => {
    if (closed) return Promise.resolve();
    if (pending) return pending;
    pending = (async () => {
      const controller = new AbortController();
      activeLookup = controller;
      let cancelWait: () => void = () => {};
      const cancelled = new Promise<undefined>((resolve) => {
        cancelWait = () => resolve(undefined);
        controller.signal.addEventListener('abort', cancelWait, { once: true });
      });
      const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
      timeout.unref();
      try {
        const found = await Promise.race([
          Promise.resolve()
            .then(() => resolveAddresses('gateway', controller.signal))
            .catch(() => undefined),
          cancelled,
        ]);
        if (
          closed ||
          controller.signal.aborted ||
          !Array.isArray(found) ||
          found.length === 0 ||
          found.length > 16
        ) {
          clear();
          return;
        }
        const normalized = found.map(canonicalAddress);
        const completedAt = now();
        if (normalized.some((address) => address === undefined) || !Number.isFinite(completedAt)) {
          clear();
          return;
        }
        addresses = new Set(normalized as string[]);
        refreshedAt = completedAt;
      } finally {
        clearTimeout(timeout);
        controller.signal.removeEventListener('abort', cancelWait);
        controller.abort();
        activeLookup = undefined;
      }
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  };

  const controller = Object.freeze({
    trustProxy(address: string, hop: number): boolean {
      const age = now() - refreshedAt;
      if (closed || hop !== 0 || !Number.isFinite(age) || age < 0 || age >= MAX_ADDRESS_AGE_MS) {
        return false;
      }
      const normalized = canonicalAddress(address);
      return normalized !== undefined && addresses.has(normalized);
    },
    refresh,
    start() {
      if (closed || interval) return;
      // Start after HTTP listen: gateway health depends on customer-web, not vice versa.
      void refresh();
      interval = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
      interval.unref();
    },
    close() {
      closed = true;
      if (interval) clearInterval(interval);
      interval = undefined;
      activeLookup?.abort();
      clear();
    },
  });
  trustedControllers.add(controller);
  return controller;
}
