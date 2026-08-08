import { loadApiConfig } from '@payreplayy/config/api';

import { runApiDatabasePreflight } from './database-preflight.js';

const config = loadApiConfig();

if (!config.postgresRuntime.enabled) {
  console.error(
    'PayReplayy API database preflight is disabled. It requires an API-only runtime secret environment.',
  );
  process.exitCode = 1;
} else {
  try {
    const result = await runApiDatabasePreflight(config.postgresRuntime);
    console.log(JSON.stringify({ status: result.passed ? 'passed' : 'failed', checks: result }));
    if (!result.passed) {
      process.exitCode = 1;
    }
  } catch {
    console.error(
      'PayReplayy API database preflight did not complete. Check the restricted runtime login and private connection configuration.',
    );
    process.exitCode = 1;
  }
}
