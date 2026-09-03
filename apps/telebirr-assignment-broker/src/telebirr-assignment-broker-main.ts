import { pathToFileURL } from 'node:url';

import {
  startTelebirrAssignmentBrokerApplication,
  type TelebirrAssignmentBrokerApplication,
  type TelebirrAssignmentBrokerApplicationDependencies,
} from './telebirr-assignment-broker-application.js';
import {
  loadTelebirrAssignmentBrokerConfig,
  type TelebirrAssignmentBrokerConfigDependencies,
} from './telebirr-assignment-broker-config.js';

export async function runTelebirrAssignmentBrokerMain(
  environment: NodeJS.ProcessEnv = process.env,
  configDependencies: TelebirrAssignmentBrokerConfigDependencies = {},
  applicationDependencies: TelebirrAssignmentBrokerApplicationDependencies = {},
): Promise<TelebirrAssignmentBrokerApplication> {
  const config = loadTelebirrAssignmentBrokerConfig(environment, configDependencies);
  return startTelebirrAssignmentBrokerApplication(config, applicationDependencies);
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  try {
    const application = await runTelebirrAssignmentBrokerMain();
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
      component: 'telebirr_assignment_broker',
      event: 'listening',
      detailsRedacted: true,
    });
  } catch {
    console.error({
      component: 'telebirr_assignment_broker',
      event: 'startup_failed',
      detailsRedacted: true,
    });
    process.exitCode = 1;
  }
}
