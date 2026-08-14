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
    },
  },
  'Worker shadow contract scaffold is ready. Provider transport, durable jobs, claims, and execution remain disabled.',
);
