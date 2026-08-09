import { loadMaintenanceConfig } from '@payreplayy/config/maintenance';

import { runNonceRetentionDatabasePreflight } from './database-preflight.js';

const config = loadMaintenanceConfig();

if (!config.nonceRetentionRuntime.enabled) {
  console.error(
    'PayReplayy nonce-retention database preflight is disabled. It requires a dedicated maintenance runtime secret environment.',
  );
  process.exitCode = 1;
} else {
  try {
    const result = await runNonceRetentionDatabasePreflight(config.nonceRetentionRuntime);
    console.log(JSON.stringify({ status: result.passed ? 'passed' : 'failed', checks: result }));
    if (!result.passed) {
      process.exitCode = 1;
    }
  } catch {
    console.error(
      'PayReplayy nonce-retention database preflight did not complete. Check the restricted maintenance login and private connection configuration.',
    );
    process.exitCode = 1;
  }
}
