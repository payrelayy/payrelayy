import { timingSafeEqual } from 'node:crypto';

import type { ExecutorConfig } from '@fetanagent/config/executor';

import { createKemerBetExecutorHealth } from './executor-health.js';
import type { KemerBetExecutorHealthServer } from './executor-health-server.js';
import {
  bindKemerBetExecutorSigterm,
  createKemerBetExecutorRunner,
  type KemerBetExecutorSignalSource,
} from './kemerbet-executor-runner.js';
import type { KemerBetAgentSessionRegistry } from './kemerbet-agent-session-registry.js';
import type { KemerBetAgentIdentityFingerprinter } from './kemerbet-agent-identity-fingerprint.js';
import type { KemerBetDepositRunResult } from './kemerbet-deposit-runtime.js';
import type { KemerBetDepositService } from './kemerbet-deposit-service.js';
import type { KemerBetHistoryReferenceFingerprinter } from './kemerbet-history-reference-fingerprint.js';
import type { KemerBetAgentIdentityBindings } from './executor-runtime-isolation.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const IDENTITY_FINGERPRINT_PATTERN = /^hmac-sha256-agent-identity-v1:[0-9a-f]{64}$/u;
const FINGERPRINTER_SELF_TEST_ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

export interface KemerBetExecutorApplication {
  run(): Promise<void>;
  stop(): Promise<void>;
}

export interface KemerBetExecutorApplicationDependencies<SelectorContract> {
  readonly loadConfiguration: () => ExecutorConfig;
  readonly loadAgentIdentityBindings: (
    config: ExecutorConfig,
  ) => Promise<KemerBetAgentIdentityBindings>;
  readonly assertBrowserExecutable: (config: ExecutorConfig) => Promise<void>;
  readonly loadSelectorContract: (config: ExecutorConfig) => Promise<SelectorContract>;
  readonly createFingerprinter: (
    config: ExecutorConfig,
  ) => Promise<KemerBetHistoryReferenceFingerprinter>;
  readonly createAgentIdentityFingerprinter: (
    config: ExecutorConfig,
  ) => Promise<KemerBetAgentIdentityFingerprinter>;
  readonly createSessionRegistry: (input: {
    readonly config: ExecutorConfig;
    readonly selectorContract: SelectorContract;
    readonly fingerprintExternalReference: KemerBetHistoryReferenceFingerprinter;
    readonly fingerprintAgentIdentity: KemerBetAgentIdentityFingerprinter;
    readonly expectedAgentIdentityBindings: ReadonlyMap<string, string>;
  }) => KemerBetAgentSessionRegistry;
  readonly createService: (
    config: ExecutorConfig,
    registry: KemerBetAgentSessionRegistry,
    platformAgentAccountIds: readonly string[],
  ) => Promise<KemerBetDepositService>;
  readonly createHealthServer: (
    health: ReturnType<typeof createKemerBetExecutorHealth>,
    config: ExecutorConfig,
  ) => KemerBetExecutorHealthServer;
  readonly signalSource?: KemerBetExecutorSignalSource;
  readonly onResult?: (result: KemerBetDepositRunResult) => void;
  readonly onDatabaseBackoff?: (delayMilliseconds: number) => void;
}

export class KemerBetExecutorApplicationUnavailableError extends Error {
  constructor() {
    super('The KemerBet executor application failed closed during startup.');
    this.name = 'KemerBetExecutorApplicationUnavailableError';
  }
}

function assertEnabled(config: ExecutorConfig): void {
  if (
    config.nodeEnv !== 'production' ||
    config.financialActionsMode !== 'live' ||
    !config.kemerBet.executorEnabled ||
    !config.kemerBet.finalActionFeatureEnabled ||
    !config.kemerBet.privateLiveDepositPilot.enabled ||
    !config.kemerBet.executionRuntime.enabled
  ) {
    throw new KemerBetExecutorApplicationUnavailableError();
  }
}

function assertHistoryReferenceFingerprinter(
  fingerprinter: KemerBetHistoryReferenceFingerprinter,
): void {
  const result = fingerprinter('fetanagent-executor-startup-self-test-v1');
  if (!/^hmac-sha256-v1:[0-9a-f]{64}$/u.test(result)) {
    throw new KemerBetExecutorApplicationUnavailableError();
  }
}

function assertAgentIdentityFingerprinter(fingerprinter: KemerBetAgentIdentityFingerprinter): void {
  const result = fingerprinter(
    FINGERPRINTER_SELF_TEST_ACCOUNT_ID,
    'fetanagent-executor-agent-identity-self-test-v1',
  );
  if (!/^hmac-sha256-agent-identity-v1:[0-9a-f]{64}$/u.test(result)) {
    throw new KemerBetExecutorApplicationUnavailableError();
  }
}

function validatedIdentityBindings(
  input: KemerBetAgentIdentityBindings,
): KemerBetAgentIdentityBindings {
  const accountIds = [...input.platformAgentAccountIds];
  const receivedBindings = input.expectedAgentIdentityBindings;
  if (
    accountIds.length < 1 ||
    accountIds.length > 64 ||
    accountIds.some(
      (accountId) =>
        !UUID_PATTERN.test(accountId) || accountId === '00000000-0000-0000-0000-000000000000',
    ) ||
    new Set(accountIds).size !== accountIds.length ||
    receivedBindings.size !== accountIds.length
  ) {
    throw new KemerBetExecutorApplicationUnavailableError();
  }
  const bindings = new Map<string, string>();
  const fingerprints = new Set<string>();
  for (const accountId of accountIds) {
    const fingerprint = receivedBindings.get(accountId);
    if (
      fingerprint === undefined ||
      !IDENTITY_FINGERPRINT_PATTERN.test(fingerprint) ||
      fingerprints.has(fingerprint)
    ) {
      throw new KemerBetExecutorApplicationUnavailableError();
    }
    bindings.set(accountId, fingerprint);
    fingerprints.add(fingerprint);
  }
  for (const accountId of receivedBindings.keys()) {
    if (!bindings.has(accountId)) throw new KemerBetExecutorApplicationUnavailableError();
  }
  return Object.freeze({
    platformAgentAccountIds: Object.freeze(accountIds),
    expectedAgentIdentityBindings: bindings as ReadonlyMap<string, string>,
  });
}

function assertDistinctHmacKeys(
  historyReferenceFingerprinter: KemerBetHistoryReferenceFingerprinter,
  agentIdentityFingerprinter: KemerBetAgentIdentityFingerprinter,
): void {
  const historyKeyFingerprint = historyReferenceFingerprinter.keyFingerprint;
  const identityKeyFingerprint = agentIdentityFingerprinter.keyFingerprint;
  if (
    !/^[0-9a-f]{64}$/u.test(historyKeyFingerprint) ||
    !/^[0-9a-f]{64}$/u.test(identityKeyFingerprint)
  ) {
    throw new KemerBetExecutorApplicationUnavailableError();
  }
  const historyBytes = Buffer.from(historyKeyFingerprint, 'hex');
  const identityBytes = Buffer.from(identityKeyFingerprint, 'hex');
  try {
    if (timingSafeEqual(historyBytes, identityBytes)) {
      throw new KemerBetExecutorApplicationUnavailableError();
    }
  } finally {
    historyBytes.fill(0);
    identityBytes.fill(0);
  }
}

async function sessionsReady(
  registry: KemerBetAgentSessionRegistry,
  accountIds: readonly string[],
): Promise<boolean> {
  if (accountIds.length === 0) return false;
  let ready = true;
  for (const accountId of accountIds) {
    try {
      const result = await registry.probeReadiness(accountId);
      if (!result.ready || result.reason !== 'ready') ready = false;
    } catch {
      ready = false;
    }
  }
  return ready;
}

export async function createKemerBetExecutorApplication<SelectorContract>(
  dependencies: KemerBetExecutorApplicationDependencies<SelectorContract>,
): Promise<KemerBetExecutorApplication> {
  let registry: KemerBetAgentSessionRegistry | null = null;
  let service: KemerBetDepositService | null = null;
  try {
    const config = dependencies.loadConfiguration();
    assertEnabled(config);
    const identityBindings = validatedIdentityBindings(
      await dependencies.loadAgentIdentityBindings(config),
    );
    const accountIds = identityBindings.platformAgentAccountIds;
    await dependencies.assertBrowserExecutable(config);
    const selectorContract = await dependencies.loadSelectorContract(config);
    const fingerprinter = await dependencies.createFingerprinter(config);
    assertHistoryReferenceFingerprinter(fingerprinter);
    const agentIdentityFingerprinter = await dependencies.createAgentIdentityFingerprinter(config);
    assertAgentIdentityFingerprinter(agentIdentityFingerprinter);
    assertDistinctHmacKeys(fingerprinter, agentIdentityFingerprinter);
    registry = dependencies.createSessionRegistry({
      config,
      selectorContract,
      fingerprintExternalReference: fingerprinter,
      fingerprintAgentIdentity: agentIdentityFingerprinter,
      expectedAgentIdentityBindings: identityBindings.expectedAgentIdentityBindings,
    });
    // Registry construction is side-effect-free. The database service acquires its lifetime
    // singleton session before the first persistent-profile launch or authenticated page probe.
    service = await dependencies.createService(config, registry, accountIds);
    if (!(await service.ready())) throw new KemerBetExecutorApplicationUnavailableError();
    if (!(await sessionsReady(registry, accountIds))) {
      throw new KemerBetExecutorApplicationUnavailableError();
    }

    const exactRegistry = registry;
    const exactService = service;
    const health = createKemerBetExecutorHealth({
      platformAgentAccountIds: accountIds,
      probeDatabase: () => exactService.ready(),
      probeSessionReadiness: (accountId) => exactRegistry.probeReadiness(accountId),
    });
    const healthServer = dependencies.createHealthServer(health, config);
    const runner = createKemerBetExecutorRunner({
      service: exactService,
      sessionRegistry: exactRegistry,
      health,
      startup: {
        validateConfiguration() {
          assertEnabled(config);
        },
        assertHistoryReferenceHmacReady() {
          assertHistoryReferenceFingerprinter(fingerprinter);
        },
        assertAgentIdentityHmacReady() {
          assertAgentIdentityFingerprinter(agentIdentityFingerprinter);
          assertDistinctHmacKeys(fingerprinter, agentIdentityFingerprinter);
        },
        async assertDatabaseCatalogPreflight() {
          if (!(await exactService.ready())) {
            throw new KemerBetExecutorApplicationUnavailableError();
          }
        },
      },
      ...(dependencies.onResult === undefined ? {} : { onResult: dependencies.onResult }),
      ...(dependencies.onDatabaseBackoff === undefined
        ? {}
        : { onDatabaseBackoff: dependencies.onDatabaseBackoff }),
    });
    let unbindSignal: (() => void) | null = null;

    return {
      async run() {
        try {
          await healthServer.start();
          unbindSignal = bindKemerBetExecutorSigterm(runner, dependencies.signalSource ?? process);
          await runner.start();
        } finally {
          unbindSignal?.();
          unbindSignal = null;
          try {
            await healthServer.close();
          } finally {
            await runner.stop();
          }
        }
      },

      async stop() {
        unbindSignal?.();
        unbindSignal = null;
        await runner.stop();
        await healthServer.close();
      },
    };
  } catch {
    if (registry !== null) await registry.close().catch(() => undefined);
    if (service !== null) await service.close().catch(() => undefined);
    throw new KemerBetExecutorApplicationUnavailableError();
  }
}
