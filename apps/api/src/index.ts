import { loadConfig, redactedConfigForLog } from '@payreplayy/config';

import { buildApp } from './app.js';

const config = loadConfig();
const app = buildApp(config);

app.log.info({ config: redactedConfigForLog(config) }, 'PayReplayy API starting');

await app.listen({ host: config.api.host, port: config.api.port });
