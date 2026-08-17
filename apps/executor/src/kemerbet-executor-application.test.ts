import {
  KEMERBET_EXECUTOR_DATABASE_TARGETS,
  KEMERBET_EXECUTOR_DATABASE_RUNTIME_ROLE,
  KEMERBET_EXECUTOR_DATABASE_SECRET_FILE,
  KEMERBET_SUPABASE_CA_CERTIFICATE_FILE,
  loadExecutorConfig,
} from '@fetanagent/config/executor';
import { describe, expect, it } from 'vitest';

import type { KemerBetExecutorHealthServer } from './executor-health-server.js';
import type { KemerBetExecutorSignalSource } from './kemerbet-executor-runner.js';
import type { KemerBetAgentSessionRegistry } from './kemerbet-agent-session-registry.js';
import type { KemerBetDepositRunResult } from './kemerbet-deposit-runtime.js';
import type { KemerBetDepositService } from './kemerbet-deposit-service.js';
import {
  createKemerBetExecutorApplication,
  KemerBetExecutorApplicationUnavailableError,
  type KemerBetExecutorApplicationDependencies,
} from './kemerbet-executor-application.js';

const AGENT_ACCOUNT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const SECOND_AGENT_ACCOUNT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const databaseUrl = `postgresql://${KEMERBET_EXECUTOR_DATABASE_RUNTIME_ROLE}:test-password@${KEMERBET_EXECUTOR_DATABASE_TARGETS.staging.host}:5432/postgres?sslmode=verify-full`;

function identityFingerprint(index: number): string {
  return `hmac-sha256-agent-identity-v1:${String(index + 1).repeat(64)}`;
}

function enabledConfig() {
  return loadExecutorConfig(
    {
      NODE_ENV: 'production',
      FINANCIAL_ACTIONS_MODE: 'live',
      KEMERBET_EXECUTOR_ENABLED: 'true',
      KEMERBET_FINAL_ACTION_ENABLED: 'true',
      INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED: 'true',
      KEMERBET_EXECUTOR_DEPLOYMENT_TARGET: 'staging',
      KEMERBET_EXECUTOR_DATABASE_URL_FILE: KEMERBET_EXECUTOR_DATABASE_SECRET_FILE,
      NODE_EXTRA_CA_CERTS: KEMERBET_SUPABASE_CA_CERTIFICATE_FILE,
    },
    () => databaseUrl,
  );
}

function circuitResult(): KemerBetDepositRunResult {
  return {
    component: 'kemerbet_deposit_executor',
    event: 'recovery_circuit_open',
    phase: 'prepare',
    actionRetryAllowed: false,
    financialDetailsRedacted: true,
    workerDisposition: 'pause',
  };
}

function dependencies(
  options: {
    readonly sessionReady?: boolean;
    readonly databaseReady?: boolean;
    readonly healthStartFails?: boolean;
    readonly accountIds?: readonly string[];
    readonly equalHmacKeys?: boolean;
  } = {},
) {
  const order: string[] = [];
  const accountIds = options.accountIds ?? [AGENT_ACCOUNT_ID];
  const identityBindings = new Map(
    accountIds.map((accountId, index) => [accountId, identityFingerprint(index)]),
  );
  let signalListener: (() => void) | null = null;
  let browserResolutions = 0;
  let activeSessionProbes = 0;
  let maximumActiveSessionProbes = 0;
  const signalSource: KemerBetExecutorSignalSource = {
    once(_event, listener) {
      signalListener = listener;
    },
    off(_event, listener) {
      if (signalListener === listener) signalListener = null;
    },
  };
  const registry: KemerBetAgentSessionRegistry = {
    async probeReadiness(accountId) {
      expect(accountIds).toContain(accountId);
      order.push('session-probe');
      activeSessionProbes += 1;
      maximumActiveSessionProbes = Math.max(maximumActiveSessionProbes, activeSessionProbes);
      await Promise.resolve();
      activeSessionProbes -= 1;
      return options.sessionReady === false
        ? { ready: false, reason: 'profile_missing' }
        : { ready: true, reason: 'ready' };
    },
    async resolveBrowser() {
      browserResolutions += 1;
      return null;
    },
    async close() {
      order.push('browser-close');
    },
  };
  const service: KemerBetDepositService = {
    async runOnce() {
      order.push('run-once');
      return circuitResult();
    },
    async ready() {
      order.push('database-ready');
      return options.databaseReady !== false;
    },
    async close() {
      order.push('database-close');
    },
  };
  const healthServer: KemerBetExecutorHealthServer = {
    async start() {
      order.push('health-start');
      if (options.healthStartFails) throw new Error('private bind failure');
    },
    async close() {
      order.push('health-close');
    },
    address: () => ({ host: '127.0.0.1', port: 8090 }),
  };
  const value: KemerBetExecutorApplicationDependencies<{ readonly version: 1 }> = {
    loadConfiguration() {
      order.push('configuration');
      return enabledConfig();
    },
    async loadAgentIdentityBindings() {
      order.push('binding-file');
      return {
        platformAgentAccountIds: accountIds,
        expectedAgentIdentityBindings: identityBindings,
      };
    },
    async assertBrowserExecutable() {
      order.push('browser-executable');
    },
    async loadSelectorContract() {
      order.push('selector-contract');
      return { version: 1 };
    },
    async createFingerprinter() {
      order.push('hmac-file');
      return Object.assign(() => `hmac-sha256-v1:${'c'.repeat(64)}`, {
        keyFingerprint: 'a'.repeat(64),
      });
    },
    async createAgentIdentityFingerprinter() {
      order.push('identity-hmac-file');
      return Object.assign(() => `hmac-sha256-agent-identity-v1:${'d'.repeat(64)}`, {
        keyFingerprint: (options.equalHmacKeys ? 'a' : 'b').repeat(64),
      });
    },
    createSessionRegistry({
      selectorContract,
      fingerprintExternalReference,
      fingerprintAgentIdentity,
      expectedAgentIdentityBindings,
    }) {
      expect(selectorContract).toEqual({ version: 1 });
      expect(fingerprintExternalReference('history')).toMatch(/^hmac-sha256-v1:/u);
      expect(fingerprintAgentIdentity(AGENT_ACCOUNT_ID, 'identity')).toMatch(
        /^hmac-sha256-agent-identity-v1:/u,
      );
      expect([...expectedAgentIdentityBindings]).toEqual([...identityBindings]);
      order.push('registry-create');
      return registry;
    },
    async createService(_config, receivedRegistry, platformAgentAccountIds) {
      expect(receivedRegistry).toBe(registry);
      expect(platformAgentAccountIds).toEqual(accountIds);
      order.push('service-create');
      return service;
    },
    createHealthServer() {
      order.push('health-create');
      return healthServer;
    },
    signalSource,
    onResult() {
      order.push('result');
      signalListener?.();
    },
  };
  return {
    value,
    order,
    browserResolutions: () => browserResolutions,
    maximumActiveSessionProbes: () => maximumActiveSessionProbes,
    signalBound: () => signalListener !== null,
  };
}

describe('KemerBet executor application composition', () => {
  it('passes every read-only preflight before polling and exits a circuit with no browser action', async () => {
    const fixture = dependencies();
    const application = await createKemerBetExecutorApplication(fixture.value);

    await application.run();
    expect(fixture.browserResolutions()).toBe(0);
    expect(fixture.signalBound()).toBe(false);
    expect(fixture.order).toEqual([
      'configuration',
      'binding-file',
      'browser-executable',
      'selector-contract',
      'hmac-file',
      'identity-hmac-file',
      'registry-create',
      'service-create',
      'database-ready',
      'session-probe',
      'health-create',
      'health-start',
      'database-ready',
      'database-ready',
      'session-probe',
      'run-once',
      'result',
      'browser-close',
      'database-close',
      'health-close',
    ]);
  });

  it('rejects disabled configuration before reading any runtime file', async () => {
    const fixture = dependencies();

    await expect(
      createKemerBetExecutorApplication({
        ...fixture.value,
        loadConfiguration: () => loadExecutorConfig({ NODE_ENV: 'production' }),
      }),
    ).rejects.toBeInstanceOf(KemerBetExecutorApplicationUnavailableError);
    expect(fixture.order).toEqual([]);
  });

  it('rejects equal history-reference and agent-identity HMAC keys before browser creation', async () => {
    const fixture = dependencies({ equalHmacKeys: true });

    await expect(createKemerBetExecutorApplication(fixture.value)).rejects.toBeInstanceOf(
      KemerBetExecutorApplicationUnavailableError,
    );
    expect(fixture.order).not.toContain('registry-create');
    expect(fixture.order).not.toContain('service-create');
  });

  it('fails closed on a missing identity key before creating a browser registry', async () => {
    const fixture = dependencies();

    await expect(
      createKemerBetExecutorApplication({
        ...fixture.value,
        async createAgentIdentityFingerprinter() {
          throw new Error('secret path and key details');
        },
      }),
    ).rejects.toBeInstanceOf(KemerBetExecutorApplicationUnavailableError);
    expect(fixture.order).not.toContain('registry-create');
    expect(fixture.order).not.toContain('service-create');
  });

  it('fails closed on missing, duplicate, or foreign account identity bindings', async () => {
    for (const bindingFixture of [
      {
        platformAgentAccountIds: [AGENT_ACCOUNT_ID],
        expectedAgentIdentityBindings: new Map<string, string>(),
      },
      {
        platformAgentAccountIds: [AGENT_ACCOUNT_ID, SECOND_AGENT_ACCOUNT_ID],
        expectedAgentIdentityBindings: new Map([
          [AGENT_ACCOUNT_ID, identityFingerprint(0)],
          [SECOND_AGENT_ACCOUNT_ID, identityFingerprint(0)],
        ]),
      },
      {
        platformAgentAccountIds: [AGENT_ACCOUNT_ID],
        expectedAgentIdentityBindings: new Map([
          [AGENT_ACCOUNT_ID, identityFingerprint(0)],
          [SECOND_AGENT_ACCOUNT_ID, identityFingerprint(1)],
        ]),
      },
    ]) {
      const fixture = dependencies();
      await expect(
        createKemerBetExecutorApplication({
          ...fixture.value,
          async loadAgentIdentityBindings() {
            return bindingFixture;
          },
        }),
      ).rejects.toBeInstanceOf(KemerBetExecutorApplicationUnavailableError);
      expect(fixture.order).not.toContain('registry-create');
    }
  });

  it('serializes the live startup probe for every configured agent account', async () => {
    const fixture = dependencies({
      accountIds: [AGENT_ACCOUNT_ID, SECOND_AGENT_ACCOUNT_ID],
    });
    const application = await createKemerBetExecutorApplication(fixture.value);

    expect(fixture.order.filter((event) => event === 'session-probe')).toHaveLength(2);
    expect(fixture.maximumActiveSessionProbes()).toBe(1);
    await application.stop();
  });

  it('acquires database readiness before probing a missing exact browser session', async () => {
    const fixture = dependencies({ sessionReady: false });

    await expect(createKemerBetExecutorApplication(fixture.value)).rejects.toBeInstanceOf(
      KemerBetExecutorApplicationUnavailableError,
    );
    expect(fixture.order.indexOf('service-create')).toBeLessThan(
      fixture.order.indexOf('session-probe'),
    );
    expect(fixture.order.slice(-2)).toEqual(['browser-close', 'database-close']);
    expect(fixture.browserResolutions()).toBe(0);
  });

  it('fails a database singleton acquisition before the first browser session probe', async () => {
    const fixture = dependencies();
    const sensitiveDatabaseDetail = 'second-executor-backend-detail';

    await expect(
      createKemerBetExecutorApplication({
        ...fixture.value,
        async createService() {
          fixture.order.push('service-create');
          throw new Error(sensitiveDatabaseDetail);
        },
      }),
    ).rejects.toBeInstanceOf(KemerBetExecutorApplicationUnavailableError);
    expect(fixture.order).not.toContain('session-probe');
    expect(fixture.order.at(-1)).toBe('browser-close');
    expect(JSON.stringify(fixture.order)).not.toContain(sensitiveDatabaseDetail);
  });

  it('fails closed on database catalog readiness and closes browser before database', async () => {
    const fixture = dependencies({ databaseReady: false });

    await expect(createKemerBetExecutorApplication(fixture.value)).rejects.toBeInstanceOf(
      KemerBetExecutorApplicationUnavailableError,
    );
    expect(fixture.order.slice(-2)).toEqual(['browser-close', 'database-close']);
    expect(fixture.order).not.toContain('session-probe');
    expect(fixture.order).not.toContain('run-once');
  });

  it('closes all resources if the private health listener cannot bind', async () => {
    const fixture = dependencies({ healthStartFails: true });
    const application = await createKemerBetExecutorApplication(fixture.value);

    await expect(application.run()).rejects.toThrow('private bind failure');
    expect(fixture.order.slice(-3)).toEqual(['health-close', 'browser-close', 'database-close']);
    expect(fixture.order).not.toContain('run-once');
  });
});
