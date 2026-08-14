import {
  CBE_BIRR_AUTHORITATIVE_SHADOW_CONTRACT_VERSION,
  evaluateCbeBirrAuthoritativeShadow,
  planCbeBirrAuthoritativeShadowAttempt,
  redactedCbeBirrAuthoritativeShadowDecisionForLog,
} from '@fetanagent/contracts';
import type { CbeBirrAuthoritativeShadowWorkerConfig } from '@fetanagent/config/worker';

type WorkerCbeBirrAuthoritativeShadowDisabledCapabilities = {
  readonly mode: 'shadow';
  readonly providerTransportEnabled: false;
  readonly durableJobsEnabled: false;
  readonly paymentClaimsEnabled: false;
  readonly kemerBetExecutionEnabled: false;
};

export type WorkerCbeBirrAuthoritativeShadowContract =
  WorkerCbeBirrAuthoritativeShadowDisabledCapabilities &
    (
      | {
          readonly enabled: false;
          readonly contractVersion: 1;
        }
      | {
          readonly enabled: true;
          readonly contractVersion: 1;
          readonly evaluate: typeof evaluateCbeBirrAuthoritativeShadow;
          readonly decisionForLog: typeof redactedCbeBirrAuthoritativeShadowDecisionForLog;
          readonly planAttempt: typeof planCbeBirrAuthoritativeShadowAttempt;
        }
    );

const disabledCapabilities: WorkerCbeBirrAuthoritativeShadowDisabledCapabilities = {
  mode: 'shadow',
  providerTransportEnabled: false,
  durableJobsEnabled: false,
  paymentClaimsEnabled: false,
  kemerBetExecutionEnabled: false,
};

/**
 * Composes only the pure advisory evaluator and planner contracts. It deliberately has no provider
 * lookup, credential, network client, database, queue, claim, or execution dependency.
 */
export function createWorkerCbeBirrAuthoritativeShadowContract(
  config: CbeBirrAuthoritativeShadowWorkerConfig,
): WorkerCbeBirrAuthoritativeShadowContract {
  if (!config.contractEnabled) {
    return {
      ...disabledCapabilities,
      enabled: false,
      contractVersion: CBE_BIRR_AUTHORITATIVE_SHADOW_CONTRACT_VERSION,
    };
  }

  return {
    ...disabledCapabilities,
    enabled: true,
    contractVersion: CBE_BIRR_AUTHORITATIVE_SHADOW_CONTRACT_VERSION,
    evaluate: evaluateCbeBirrAuthoritativeShadow,
    decisionForLog: redactedCbeBirrAuthoritativeShadowDecisionForLog,
    planAttempt: planCbeBirrAuthoritativeShadowAttempt,
  };
}
