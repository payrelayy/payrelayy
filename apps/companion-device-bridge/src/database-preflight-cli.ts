import { startCompanionDeviceBridgeApplication } from './application.js';
import { loadCompanionDeviceBridgeConfig } from './config.js';
import {
  createCompanionDeviceBridgePostgresRuntime,
  type CompanionDeviceBridgeInitialPreflightFailure,
} from './postgres-runtime.js';

const config = loadCompanionDeviceBridgeConfig();

if (!config.enabled) {
  console.error(
    'FetanAgent companion device bridge database preflight is disabled. Enable only the dedicated staging pairing runtime.',
  );
  process.exitCode = 1;
} else {
  let initialFailure: CompanionDeviceBridgeInitialPreflightFailure | undefined;
  try {
    const application = await startCompanionDeviceBridgeApplication(config, {
      createPostgresRuntime: (connection, signerKeyId) =>
        createCompanionDeviceBridgePostgresRuntime(connection, signerKeyId, {
          onInitialPreflightFailure: (failure) => {
            initialFailure = failure;
          },
        }),
      createServer: () => ({
        server: { listening: true },
        listen: () => Promise.resolve(),
        ready: () => true,
        close: () => Promise.resolve(),
      }),
    });
    if (!(await application.ready())) throw new Error();
    await application.close();
    console.info('Companion device bridge database preflight passed.');
  } catch {
    const diagnostic =
      initialFailure?.kind === 'catalog_checks_rejected'
        ? `${initialFailure.kind}:${initialFailure.checks.join(',')}`
        : (initialFailure?.kind ?? 'application_unavailable');
    console.error(
      `FetanAgent companion device bridge database preflight did not complete. Check the function-only staging runtime configuration. Safe diagnostic: ${diagnostic}.`,
    );
    process.exitCode = 1;
  }
}
