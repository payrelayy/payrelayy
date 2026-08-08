import { loadApiConfig, redactedApiConfigForLog } from '@payreplayy/config/api';

import { buildApp } from './app.js';

const config = loadApiConfig();
const app = buildApp(config);

app.log.info({ config: redactedApiConfigForLog(config) }, 'PayReplayy API starting');

await app.listen({ host: config.api.host, port: config.api.port });
