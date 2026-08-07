import { loadConfig, redactedConfigForLog } from '@payreplayy/config';
import { mayPerformFinalKemerBetAction } from '@payreplayy/domain';

const config = loadConfig();
const finalActionAllowed = mayPerformFinalKemerBetAction(
  config.financialActionsMode,
  config.kemerBet.finalActionFeatureEnabled,
);

console.info(
  { config: redactedConfigForLog(config), finalActionAllowed },
  'KemerBet executor scaffold is ready. It will not open a browser or perform a transfer in Stage 0.',
);
