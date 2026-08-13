import {
  loadOwnerControlConfig,
  redactedOwnerControlConfigForLog,
} from '@fetanagent/config/owner-control';

import { buildOwnerControlApp } from './app.js';
import { createOwnerControlPostgresRuntime } from './postgres-runtime.js';

const config = loadOwnerControlConfig();
if (!config.runtime.enabled) throw new Error('The Owner-control staging runtime gate is disabled.');

const runtime = await createOwnerControlPostgresRuntime(config.runtime);
const app = buildOwnerControlApp(config, { runtime });
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
  { config: redactedOwnerControlConfigForLog(config) },
  'FetanAgent Owner-control service starting',
);
try {
  await app.listen({ host: config.server.host, port: config.server.port });
} catch {
  await closeGracefully();
  throw new Error('The Owner-control service could not start.');
}
