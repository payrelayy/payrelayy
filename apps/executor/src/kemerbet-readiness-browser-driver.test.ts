import { describe, expect, it, vi } from 'vitest';

import {
  createKemerBetReadinessRawIdentityCapture,
  createKemerBetReadinessBrowserControlIpv4Revalidator,
  KEMERBET_READINESS_BROWSER_DRIVER_CONTRACT,
  KemerBetReadinessBrowserDriverUnavailableError,
  runKemerBetReadinessBrowserDriver,
  type KemerBetReadinessBrowserDriverDependencies,
} from './kemerbet-readiness-browser-driver.js';
import type { KemerBetNoTransferReadinessSealProbe } from './kemerbet-no-transfer-readiness-seal.js';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const AUTHORIZATION = `v1.${'a'.repeat(32)}.1.${'b'.repeat(64)}`;

function environment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    FINANCIAL_ACTIONS_MODE: 'dry_run',
    KEMERBET_READINESS_BROWSER_DRIVER_ENABLED: 'true',
    KEMERBET_EXECUTOR_ENABLED: 'false',
    KEMERBET_FINAL_ACTION_ENABLED: 'false',
    KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED: 'false',
    INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED: 'false',
    KEMERBET_READINESS_L7_PROXY_IPV4: '172.31.254.10',
    KEMERBET_READINESS_L7_PROXY_SPKI_SHA256: `${'A'.repeat(43)}=`,
  };
}

function dependencies(
  overrides: Partial<KemerBetReadinessBrowserDriverDependencies> = {},
): KemerBetReadinessBrowserDriverDependencies {
  return {
    environment: environment(),
    effectiveUserId: 10001,
    waitForFirewallRelease: async () => undefined,
    assertSensitivePathsAbsent: async () => undefined,
    assertBrowserExecutable: async () => undefined,
    createNetworkRevalidator: async () => async () => undefined,
    createControlIpv4Revalidator: async () => async () => undefined,
    loadAccountId: async () => ACCOUNT_ID,
    loadCapability: async () => Buffer.alloc(32, 0x5a),
    loadSelectorContract: async () => ({ version: 2 }) as never,
    ...overrides,
  };
}

describe('KemerBet readiness browser driver', () => {
  it('attests the fixed control IPv4 on one stable browser interface', async () => {
    let interfaceName = 'control0';
    const revalidate = await createKemerBetReadinessBrowserControlIpv4Revalidator({
      captureNetworkInterfaces: () =>
        ({
          [interfaceName]: [{ address: '172.31.254.3', family: 'IPv4', internal: false }],
          proxy0: [{ address: '172.31.254.11', family: 'IPv4', internal: false }],
        }) as never,
    });
    await expect(revalidate()).resolves.toBeUndefined();
    interfaceName = 'replacement0';
    await expect(revalidate()).rejects.toBeInstanceOf(
      KemerBetReadinessBrowserDriverUnavailableError,
    );
  });

  it('binds only the fixed control IP and forwards only one current ID/token to the guarded probe', async () => {
    const revalidateNetwork = vi.fn(async () => undefined);
    const revalidateControl = vi.fn(async () => undefined);
    const lookupTargets: unknown[] = [];
    const probeClose = vi.fn(async () => undefined);
    const probeFinalize = vi.fn(async () => undefined);
    const serverClose = vi.fn(async () => undefined);
    const openProbe = vi.fn(async (options) => {
      const fingerprint = options.fingerprintAgentIdentity(ACCOUNT_ID, 'raw-agent-identity');
      return {
        observedAgentIdentityFingerprint: fingerprint,
        providerAuthorizationDigest: () => `sha256-provider-authorization-v1:${'3'.repeat(64)}`,
        probePlayerLookup: async (target) => {
          lookupTargets.push(target);
          return {
            exactPlayerMatch: true as const,
            exactCurrencyMatch: true as const,
            transferDisabled: true as const,
          };
        },
        finalizeReadOnlyProof: probeFinalize,
        close: probeClose,
      } satisfies KemerBetNoTransferReadinessSealProbe;
    });
    const startServer = vi.fn(async (options) => {
      expect(options.host).toBe('172.31.254.3');
      const session = await options.openSession();
      expect(session.agentIdentity).toBe('raw-agent-identity');
      await session.lookup('PLAYER-1', AUTHORIZATION);
      await session.finalize();
      await session.close();
      return {
        completed: Promise.resolve('succeeded' as const),
        origin: 'http://172.31.254.3:4587',
        close: serverClose,
      };
    });

    await expect(
      runKemerBetReadinessBrowserDriver(
        dependencies({
          createNetworkRevalidator: async () => revalidateNetwork,
          createControlIpv4Revalidator: async () => revalidateControl,
          openProbe,
          startServer,
        }),
      ),
    ).resolves.toBeUndefined();

    expect(lookupTargets).toEqual([
      { currencyCode: 'ETB', layer7Authorization: AUTHORIZATION, playerId: 'PLAYER-1' },
    ]);
    expect(revalidateNetwork.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(revalidateControl.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(probeFinalize).toHaveBeenCalledOnce();
    expect(probeClose).toHaveBeenCalledOnce();
    expect(serverClose).toHaveBeenCalledOnce();
  });

  it('rejects the wrong UID before loading any account, capability, or profile', async () => {
    const loadAccountId = vi.fn();
    const loadCapability = vi.fn();
    const openProbe = vi.fn();

    await expect(
      runKemerBetReadinessBrowserDriver(
        dependencies({ effectiveUserId: 10002, loadAccountId, loadCapability, openProbe }),
      ),
    ).rejects.toBeInstanceOf(KemerBetReadinessBrowserDriverUnavailableError);
    expect(loadAccountId).not.toHaveBeenCalled();
    expect(loadCapability).not.toHaveBeenCalled();
    expect(openProbe).not.toHaveBeenCalled();
  });

  it('stops before loading browser inputs when a sensitive mount is present', async () => {
    const loadCapability = vi.fn();
    await expect(
      runKemerBetReadinessBrowserDriver(
        dependencies({
          assertSensitivePathsAbsent: async () => {
            throw new Error('present');
          },
          loadCapability,
        }),
      ),
    ).rejects.toBeInstanceOf(KemerBetReadinessBrowserDriverUnavailableError);
    expect(loadCapability).not.toHaveBeenCalled();
    expect(KEMERBET_READINESS_BROWSER_DRIVER_CONTRACT.sensitivePaths).toContain(
      '/run/secrets/kemerbet_readiness_layer7_authorizations',
    );
  });

  it('closes a probe when raw identity capture never completed', async () => {
    const probeClose = vi.fn(async () => undefined);
    await expect(
      runKemerBetReadinessBrowserDriver(
        dependencies({
          openProbe: async () => ({
            observedAgentIdentityFingerprint: `hmac-sha256-agent-identity-v1:${'0'.repeat(64)}`,
            providerAuthorizationDigest: () => `sha256-provider-authorization-v1:${'3'.repeat(64)}`,
            probePlayerLookup: async () => null,
            finalizeReadOnlyProof: async () => undefined,
            close: probeClose,
          }),
          startServer: async (options) => {
            await options.openSession();
            throw new Error('must not start');
          },
        }),
      ),
    ).rejects.toBeInstanceOf(KemerBetReadinessBrowserDriverUnavailableError);
    expect(probeClose).toHaveBeenCalledOnce();
  });

  it('rejects account identity drift and erases capture state on destroy', () => {
    const capture = createKemerBetReadinessRawIdentityCapture(ACCOUNT_ID);
    capture.fingerprintAgentIdentity(ACCOUNT_ID, 'first-identity');
    expect(() => capture.fingerprintAgentIdentity(ACCOUNT_ID, 'second-identity')).toThrow(
      KemerBetReadinessBrowserDriverUnavailableError,
    );
    capture.destroy();
    expect(() => capture.takeIdentity()).toThrow(KemerBetReadinessBrowserDriverUnavailableError);
  });

  it('rejects the former account-id environment exposure', async () => {
    await expect(
      runKemerBetReadinessBrowserDriver(
        dependencies({
          environment: {
            ...environment(),
            KEMERBET_AGENT_IDENTITY_BINDING_ACCOUNT_ID: ACCOUNT_ID,
          },
        }),
      ),
    ).rejects.toBeInstanceOf(KemerBetReadinessBrowserDriverUnavailableError);
  });
});
