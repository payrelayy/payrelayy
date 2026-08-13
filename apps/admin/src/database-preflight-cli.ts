import { loadOwnerControlConfig } from '@fetanagent/config/owner-control';

import { createOwnerControlPostgresRuntime } from './postgres-runtime.js';

const config = loadOwnerControlConfig();

if (!config.runtime.enabled) {
  console.error(
    'FetanAgent Owner-control database preflight is disabled. Enable only the dedicated staging runtime environment.',
  );
  process.exitCode = 1;
} else {
  try {
    const runtime = await createOwnerControlPostgresRuntime(config.runtime);
    await runtime.close();
    console.info('Owner-control database preflight passed.');
  } catch {
    console.error(
      'FetanAgent Owner-control database preflight did not complete. Check the restricted staging runtime configuration.',
    );
    process.exitCode = 1;
  }
}
