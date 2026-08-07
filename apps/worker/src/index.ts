import { loadConfig, redactedConfigForLog } from '@payreplayy/config';

const config = loadConfig();

console.info(
  { config: redactedConfigForLog(config) },
  'Worker scaffold is ready. Durable jobs are not enabled until the database migration is reviewed.',
);
