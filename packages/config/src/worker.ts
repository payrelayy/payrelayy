import { booleanFromEnv, loadRuntimeConfig, type RuntimeConfig } from './shared.js';

export interface CbeBirrAuthoritativeShadowWorkerConfig {
  /** Enables only the pure advisory contract; no transport or runner is composed by this gate. */
  readonly contractEnabled: boolean;
  readonly mode: 'shadow';
  readonly providerTransportEnabled: false;
  readonly durableJobsEnabled: false;
  readonly paymentClaimsEnabled: false;
  readonly kemerBetExecutionEnabled: false;
}

export type WorkerConfig = RuntimeConfig & {
  readonly cbeBirrAuthoritativeShadow: CbeBirrAuthoritativeShadowWorkerConfig;
};

export interface RedactedWorkerConfig {
  readonly nodeEnv: WorkerConfig['nodeEnv'];
  readonly logLevel: string;
  readonly cbeBirrAuthoritativeShadow: CbeBirrAuthoritativeShadowWorkerConfig;
}

export function loadWorkerConfig(environment: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    ...loadRuntimeConfig(environment),
    cbeBirrAuthoritativeShadow: {
      contractEnabled: booleanFromEnv(
        environment.INTERNAL_CBE_BIRR_AUTHORITATIVE_SHADOW_CONTRACT_ENABLED,
        false,
        'INTERNAL_CBE_BIRR_AUTHORITATIVE_SHADOW_CONTRACT_ENABLED',
      ),
      mode: 'shadow',
      providerTransportEnabled: false,
      durableJobsEnabled: false,
      paymentClaimsEnabled: false,
      kemerBetExecutionEnabled: false,
    },
  };
}

export function redactedWorkerConfigForLog(config: WorkerConfig): RedactedWorkerConfig {
  return {
    nodeEnv: config.nodeEnv,
    logLevel: config.logLevel,
    cbeBirrAuthoritativeShadow: {
      contractEnabled: config.cbeBirrAuthoritativeShadow.contractEnabled,
      mode: 'shadow',
      providerTransportEnabled: false,
      durableJobsEnabled: false,
      paymentClaimsEnabled: false,
      kemerBetExecutionEnabled: false,
    },
  };
}
