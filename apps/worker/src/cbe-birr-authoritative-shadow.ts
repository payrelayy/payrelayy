import {
  CBE_BIRR_AUTHORITATIVE_SHADOW_CONTRACT_VERSION,
  evaluateCbeBirrAuthoritativeShadow,
  redactedCbeBirrAuthoritativeShadowDecisionForLog,
} from '@fetanagent/contracts';
import type { CbeBirrAuthoritativeShadowWorkerConfig } from '@fetanagent/config/worker';

export type WorkerCbeBirrAuthoritativeShadowContract =
  | {
      readonly enabled: false;
      readonly contractVersion: 1;
    }
  | {
      readonly enabled: true;
      readonly contractVersion: 1;
      readonly evaluate: typeof evaluateCbeBirrAuthoritativeShadow;
      readonly decisionForLog: typeof redactedCbeBirrAuthoritativeShadowDecisionForLog;
    };

/**
 * Composes only the pure decision contract. It deliberately has no provider lookup, credential,
 * network client, database, queue, claim, or execution dependency.
 */
export function createWorkerCbeBirrAuthoritativeShadowContract(
  config: CbeBirrAuthoritativeShadowWorkerConfig,
): WorkerCbeBirrAuthoritativeShadowContract {
  if (!config.contractEnabled) {
    return {
      enabled: false,
      contractVersion: CBE_BIRR_AUTHORITATIVE_SHADOW_CONTRACT_VERSION,
    };
  }

  return {
    enabled: true,
    contractVersion: CBE_BIRR_AUTHORITATIVE_SHADOW_CONTRACT_VERSION,
    evaluate: evaluateCbeBirrAuthoritativeShadow,
    decisionForLog: redactedCbeBirrAuthoritativeShadowDecisionForLog,
  };
}
