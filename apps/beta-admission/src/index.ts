import {
  loadBetaAdmissionConfig,
  redactedBetaAdmissionConfigForLog,
} from '@payreplayy/config/beta-admission';

import { buildBetaAdmissionApp } from './app.js';
import { createBetaAdmissionPostgresRuntime } from './postgres-runtime.js';

const config = loadBetaAdmissionConfig();
if (!config.runtime.enabled) {
  throw new Error('The beta-admission staging runtime gate is disabled.');
}

const runtime = await createBetaAdmissionPostgresRuntime(config.runtime);
const app = buildBetaAdmissionApp(config, { runtime });
let closing = false;

const closeGracefully = async () => {
  if (closing) return;
  closing = true;
  try {
    await app.close();
  } catch {
    process.exitCode = 1;
  }
};

process.once('SIGINT', closeGracefully);
process.once('SIGTERM', closeGracefully);

app.log.info(
  { config: redactedBetaAdmissionConfigForLog(config) },
  'PayReplayy beta-admission service starting',
);

try {
  await app.listen({ host: config.server.host, port: config.server.port });
} catch {
  await closeGracefully();
  throw new Error('The beta-admission service could not start.');
}
