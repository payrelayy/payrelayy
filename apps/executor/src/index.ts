import { loadConfig, redactedConfigForLog } from '@payreplayy/config';

const config = loadConfig();
const finalActionAllowed = false;

console.info(
  { config: redactedConfigForLog(config), finalActionAllowed },
  'KemerBet executor scaffold is ready. It will not open a browser or perform a transfer in Stage 0.',
);
