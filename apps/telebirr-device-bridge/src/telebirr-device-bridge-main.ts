import { pathToFileURL } from 'node:url';

import {
  startTelebirrDeviceBridgeApplication,
  type TelebirrDeviceBridgeApplication,
  type TelebirrDeviceBridgeApplicationDependencies,
} from './telebirr-device-bridge-application.js';
import {
  loadTelebirrDeviceBridgeConfig,
  type TelebirrDeviceBridgeConfigDependencies,
} from './telebirr-device-bridge-config.js';

export async function runTelebirrDeviceBridgeMain(
  environment: NodeJS.ProcessEnv = process.env,
  configDependencies: TelebirrDeviceBridgeConfigDependencies = {},
  applicationDependencies: TelebirrDeviceBridgeApplicationDependencies = {},
): Promise<TelebirrDeviceBridgeApplication> {
  const config = loadTelebirrDeviceBridgeConfig(environment, configDependencies);
  return startTelebirrDeviceBridgeApplication(config, applicationDependencies);
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  try {
    const application = await runTelebirrDeviceBridgeMain();
    let stopping = false;
    const close = (): void => {
      if (stopping) return;
      stopping = true;
      void application.close().catch(() => {
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    console.info({
      component: 'telebirr_device_bridge',
      event: 'listening',
      detailsRedacted: true,
    });
  } catch {
    console.error({
      component: 'telebirr_device_bridge',
      event: 'startup_failed',
      detailsRedacted: true,
    });
    process.exitCode = 1;
  }
}
