import { loadWorkerConfig, redactedWorkerConfigForLog } from '@fetanagent/config/worker';

import { createWorkerCbeBirrAuthoritativeShadowContract } from './cbe-birr-authoritative-shadow.js';

const config = loadWorkerConfig();
const cbeBirrAuthoritativeShadow = createWorkerCbeBirrAuthoritativeShadowContract(
  config.cbeBirrAuthoritativeShadow,
);

console.info(
  {
    config: redactedWorkerConfigForLog(config),
    cbeBirrAuthoritativeShadow: {
      enabled: cbeBirrAuthoritativeShadow.enabled,
      contractVersion: cbeBirrAuthoritativeShadow.contractVersion,
      plannerEnabled: cbeBirrAuthoritativeShadow.enabled,
      mode: cbeBirrAuthoritativeShadow.mode,
      providerTransportEnabled: cbeBirrAuthoritativeShadow.providerTransportEnabled,
      durableJobsEnabled: cbeBirrAuthoritativeShadow.durableJobsEnabled,
      paymentClaimsEnabled: cbeBirrAuthoritativeShadow.paymentClaimsEnabled,
      kemerBetExecutionEnabled: cbeBirrAuthoritativeShadow.kemerBetExecutionEnabled,
    },
  },
  'Worker shadow evaluator/planner scaffold is ready. Provider transport, durable jobs, claims, and execution remain disabled.',
);
