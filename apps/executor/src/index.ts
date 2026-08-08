import { loadExecutorConfig, redactedExecutorConfigForLog } from '@payreplayy/config/executor';

const config = loadExecutorConfig();
const finalActionAllowed = false;

console.info(
  { config: redactedExecutorConfigForLog(config), finalActionAllowed },
  'KemerBet executor scaffold is ready. It will not open a browser or perform a transfer in Stage 0.',
);
