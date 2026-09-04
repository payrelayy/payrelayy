import { pathToFileURL } from 'node:url';

import {
  startTelebirrDeviceStateBrokerApplication,
  type TelebirrDeviceStateBrokerApplication,
  type TelebirrDeviceStateBrokerApplicationDependencies,
} from './telebirr-device-state-broker-application.js';
import {
  loadTelebirrDeviceStateBrokerConfig,
  type TelebirrDeviceStateBrokerConfigDependencies,
} from './telebirr-device-state-broker-config.js';

export async function runTelebirrDeviceStateBrokerMain(
  environment: NodeJS.ProcessEnv = process.env,
  configDependencies: TelebirrDeviceStateBrokerConfigDependencies = {},
  applicationDependencies: TelebirrDeviceStateBrokerApplicationDependencies = {},
): Promise<TelebirrDeviceStateBrokerApplication> {
  const config = loadTelebirrDeviceStateBrokerConfig(environment, configDependencies);
  return startTelebirrDeviceStateBrokerApplication(config, applicationDependencies);
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  try {
    const application = await runTelebirrDeviceStateBrokerMain();
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
      component: 'telebirr_device_state_broker',
      event: 'listening',
      detailsRedacted: true,
    });
  } catch {
    console.error({
      component: 'telebirr_device_state_broker',
      event: 'startup_failed',
      detailsRedacted: true,
    });
    process.exitCode = 1;
  }
}
