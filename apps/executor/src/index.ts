import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { loadExecutorConfig } from '@fetanagent/config/executor';

import {
  assertKemerBetBrowserExecutable,
  loadKemerBetAgentIdentityBindings,
  loadKemerBetSelectorContract,
} from './executor-runtime-isolation.js';
import { createKemerBetExecutorHealthServer } from './executor-health-server.js';
import { createKemerBetAgentIdentityFingerprinter } from './kemerbet-agent-identity-fingerprint.js';
import {
  createKemerBetAgentSessionRegistry,
  type KemerBetAgentSessionRegistry,
} from './kemerbet-agent-session-registry.js';
import {
  createKemerBetDepositService,
  type KemerBetDepositService,
} from './kemerbet-deposit-service.js';
import {
  createKemerBetExecutorApplication,
  type KemerBetExecutorApplication,
} from './kemerbet-executor-application.js';
import { createKemerBetHistoryReferenceFingerprinter } from './kemerbet-history-reference-fingerprint.js';
import {
  assertKemerBetAgentPageSelectorContractV2,
  type KemerBetAgentPageSelectorContractV2,
} from './playwright-kemerbet-agent-page.js';

const EXECUTION_LEASE_SECONDS = 300;

function validateSelectorContract(value: unknown): KemerBetAgentPageSelectorContractV2 {
  assertKemerBetAgentPageSelectorContractV2(value);
  return value;
}

function logRedactedExecutorResult(result: {
  readonly component: string;
  readonly event: string;
  readonly phase: string;
  readonly actionRetryAllowed: false;
  readonly financialDetailsRedacted: true;
}): void {
  console.info(
    {
      component: result.component,
      event: result.event,
      phase: result.phase,
      actionRetryAllowed: false,
      financialDetailsRedacted: true,
    },
    'FetanAgent deposit executor state changed.',
  );
}

/**
 * Compose the private executor from fixed production paths. Every file and session probe is
 * read-only; the application does not expose an enqueue or financial-action HTTP endpoint.
 */
export function createProductionKemerBetExecutorApplication(): Promise<KemerBetExecutorApplication> {
  return createKemerBetExecutorApplication<KemerBetAgentPageSelectorContractV2>({
    loadConfiguration: loadExecutorConfig,

    loadAgentIdentityBindings(config) {
      return loadKemerBetAgentIdentityBindings({
        filePath: config.kemerBet.runtimeIsolation.agentIdentityBindingsFile,
      });
    },

    assertBrowserExecutable(config) {
      return assertKemerBetBrowserExecutable({
        executablePath: config.kemerBet.runtimeIsolation.browserExecutablePath,
      });
    },

    loadSelectorContract(config) {
      return loadKemerBetSelectorContract({
        filePath: config.kemerBet.runtimeIsolation.selectorContractFile,
        validate: validateSelectorContract,
      });
    },

    createFingerprinter(config) {
      return createKemerBetHistoryReferenceFingerprinter({
        secretFilePath: config.kemerBet.runtimeIsolation.historyReferenceHmacKeyFile,
      });
    },

    createAgentIdentityFingerprinter(config) {
      return createKemerBetAgentIdentityFingerprinter({
        secretFilePath: config.kemerBet.runtimeIsolation.agentIdentityHmacKeyFile,
      });
    },

    createSessionRegistry({
      config,
      selectorContract,
      fingerprintExternalReference,
      fingerprintAgentIdentity,
      expectedAgentIdentityBindings,
    }) {
      return createKemerBetAgentSessionRegistry({
        profilesRoot: config.kemerBet.runtimeIsolation.agentProfilesRoot,
        browserExecutablePath: config.kemerBet.runtimeIsolation.browserExecutablePath,
        selectorContract,
        fingerprintExternalReference,
        fingerprintAgentIdentity,
        expectedAgentIdentityBindings,
        now: () => new Date(),
        headless: true,
      });
    },

    createService(
      config,
      registry: KemerBetAgentSessionRegistry,
      platformAgentAccountIds,
    ): Promise<KemerBetDepositService> {
      const approvedAgentAccounts = new Set(platformAgentAccountIds);
      return createKemerBetDepositService(config, {
        browserForAgentAccount: (platformAgentAccountId) =>
          approvedAgentAccounts.has(platformAgentAccountId)
            ? registry.resolveBrowser(platformAgentAccountId)
            : Promise.resolve(null),
        workerInstanceId: randomUUID(),
        leaseSeconds: EXECUTION_LEASE_SECONDS,
        now: () => new Date(),
        log: logRedactedExecutorResult,
      });
    },

    createHealthServer(health, config) {
      return createKemerBetExecutorHealthServer(health, {
        host: config.kemerBet.runtimeIsolation.healthHost,
        port: config.kemerBet.runtimeIsolation.healthPort,
      });
    },

    onDatabaseBackoff(delayMilliseconds) {
      console.warn(
        {
          component: 'kemerbet_deposit_executor',
          event: 'database_backoff',
          delayMilliseconds,
          financialDetailsRedacted: true,
        },
        'FetanAgent deposit executor database operation is unavailable.',
      );
    },
  });
}

export interface KemerBetExecutorMainDependencies {
  readonly createApplication?: () => Promise<KemerBetExecutorApplication>;
  readonly reportFailure?: () => void;
  readonly setExitCode?: (exitCode: number) => void;
}

/** Run the long-lived private executor, reporting only a generic fail-closed startup/runtime error. */
export async function runKemerBetExecutorMain(
  dependencies: KemerBetExecutorMainDependencies = {},
): Promise<void> {
  try {
    const application = await (
      dependencies.createApplication ?? createProductionKemerBetExecutorApplication
    )();
    await application.run();
  } catch {
    (
      dependencies.reportFailure ??
      (() => console.error('FetanAgent deposit executor failed closed.'))
    )();
    (dependencies.setExitCode ?? ((exitCode) => (process.exitCode = exitCode)))(1);
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  await runKemerBetExecutorMain();
}
