import { loadBetaAdmissionConfig } from '@fetanagent/config/beta-admission';

import { runBetaAdmissionCatalogPreflight } from './catalog-preflight.js';

const config = loadBetaAdmissionConfig();

if (!config.runtime.enabled) {
  console.error(
    'FetanAgent beta-admission preflight is disabled. Enable only the dedicated staging runtime environment.',
  );
  process.exitCode = 1;
} else {
  try {
    const result = await runBetaAdmissionCatalogPreflight(config.runtime);
    console.log(JSON.stringify({ status: result.passed ? 'passed' : 'failed', checks: result }));
    if (!result.passed) process.exitCode = 1;
  } catch {
    console.error(
      'FetanAgent beta-admission preflight did not complete. Check the restricted staging runtime configuration.',
    );
    process.exitCode = 1;
  }
}
