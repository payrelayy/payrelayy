import { loadWorkerConfig, redactedWorkerConfigForLog } from '@fetanagent/config/worker';

const config = loadWorkerConfig();

console.info(
  { config: redactedWorkerConfigForLog(config) },
  'Worker scaffold is ready. Durable jobs are not enabled until the database migration is reviewed.',
);
