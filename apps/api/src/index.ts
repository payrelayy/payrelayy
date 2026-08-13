import { loadApiConfig, redactedApiConfigForLog } from '@fetanagent/config/api';

import { buildApp } from './app.js';

const config = loadApiConfig();
const app = buildApp(config);

app.log.info({ config: redactedApiConfigForLog(config) }, 'FetanAgent API starting');

await app.listen({ host: config.api.host, port: config.api.port });
