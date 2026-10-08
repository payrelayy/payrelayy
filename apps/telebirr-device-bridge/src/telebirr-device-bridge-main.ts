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
import { createRoutineNoMoneyBridgeHandler } from './routine-no-money-bridge.js';
import { createRoutineNoMoneyUnixDependencies } from './local-routine-no-money-broker-client.js';
import { createRoutinePaidPollBridgeHandler } from './routine-paid-poll-bridge.js';
import { createRoutinePaidPollUnixDependencies } from './local-routine-paid-poll-broker-client.js';

export async function runTelebirrDeviceBridgeMain(
  environment: NodeJS.ProcessEnv = process.env,
  configDependencies: TelebirrDeviceBridgeConfigDependencies = {},
  applicationDependencies: TelebirrDeviceBridgeApplicationDependencies = {},
): Promise<TelebirrDeviceBridgeApplication> {
  const config = loadTelebirrDeviceBridgeConfig(environment, configDependencies);
  const routineMode = environment.INTERNAL_ROUTINE_NO_MONEY_BRIDGE_ENABLED;
  const paidMode = environment.INTERNAL_ROUTINE_PAID_POLL_BRIDGE_ENABLED;
  if (routineMode !== undefined && routineMode !== 'false' && routineMode !== 'true') {
    throw new Error('The routine no-money bridge mode is unavailable.');
  }
  if (paidMode !== undefined && paidMode !== 'false' && paidMode !== 'true') {
    throw new Error('The routine paid poll bridge mode is unavailable.');
  }
  if (routineMode !== 'true' && paidMode !== 'true') {
    return startTelebirrDeviceBridgeApplication(config, applicationDependencies);
  }
  if (
    !config.enabled ||
    config.deploymentTarget !== 'production' ||
    environment.FINANCIAL_ACTIONS_MODE !== 'dry_run' ||
    (routineMode === 'true' && applicationDependencies.createRoutineHandler !== undefined) ||
    (paidMode === 'true' && applicationDependencies.createPaidPollHandler !== undefined)
  ) {
    throw new Error('The routine TeleBirr bridge mode is unavailable.');
  }
  return startTelebirrDeviceBridgeApplication(config, {
    ...applicationDependencies,
    ...(routineMode === 'true'
      ? {
          createRoutineHandler: () =>
            createRoutineNoMoneyBridgeHandler(createRoutineNoMoneyUnixDependencies()),
        }
      : {}),
    ...(paidMode === 'true'
      ? {
          createPaidPollHandler: () =>
            createRoutinePaidPollBridgeHandler(createRoutinePaidPollUnixDependencies()),
        }
      : {}),
  });
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
