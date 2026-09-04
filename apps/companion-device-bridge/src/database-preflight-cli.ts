import { startCompanionDeviceBridgeApplication } from './application.js';
import { loadCompanionDeviceBridgeConfig } from './config.js';

const config = loadCompanionDeviceBridgeConfig();

if (!config.enabled) {
  console.error(
    'FetanAgent companion device bridge database preflight is disabled. Enable only the dedicated staging pairing runtime.',
  );
  process.exitCode = 1;
} else {
  try {
    const application = await startCompanionDeviceBridgeApplication(config, {
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
    console.error(
      'FetanAgent companion device bridge database preflight did not complete. Check the function-only staging runtime configuration.',
    );
    process.exitCode = 1;
  }
}
