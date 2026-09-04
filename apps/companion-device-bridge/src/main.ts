import { pathToFileURL } from 'node:url';

import {
  startCompanionDeviceBridgeApplication,
  type CompanionDeviceBridgeApplication,
  type CompanionDeviceBridgeApplicationDependencies,
} from './application.js';
import {
  loadCompanionDeviceBridgeConfig,
  redactedCompanionDeviceBridgeConfigForLog,
  type CompanionDeviceBridgeConfigDependencies,
} from './config.js';

export async function runCompanionDeviceBridgeMain(
  environment: NodeJS.ProcessEnv = process.env,
  configDependencies: CompanionDeviceBridgeConfigDependencies = {},
  applicationDependencies: CompanionDeviceBridgeApplicationDependencies = {},
): Promise<CompanionDeviceBridgeApplication> {
  const config = loadCompanionDeviceBridgeConfig(environment, configDependencies);
  const application = await startCompanionDeviceBridgeApplication(config, applicationDependencies);
  console.info({
    component: 'companion_device_bridge',
    event: 'listening',
    config: redactedCompanionDeviceBridgeConfigForLog(config),
    detailsRedacted: true,
  });
  return application;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  try {
    const application = await runCompanionDeviceBridgeMain();
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
  } catch {
    console.error({
      component: 'companion_device_bridge',
      event: 'startup_failed',
      detailsRedacted: true,
    });
    process.exitCode = 1;
  }
}
