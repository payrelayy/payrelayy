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

export const TELEBIRR_ASSIGNMENT_BROKER_PROCESS_READINESS_INTERVAL_MILLISECONDS = 5_000;

type TelebirrAssignmentBrokerProcessSignal = 'SIGINT' | 'SIGTERM';

export interface TelebirrAssignmentBrokerProcessRuntime {
  exitCode: number | undefined;
  once(event: TelebirrAssignmentBrokerProcessSignal, listener: () => void): unknown;
  removeListener(event: TelebirrAssignmentBrokerProcessSignal, listener: () => void): unknown;
}

export interface TelebirrAssignmentBrokerProcessSupervisorDependencies {
  readonly processRuntime?: TelebirrAssignmentBrokerProcessRuntime;
  readonly reportRuntimeUnavailable?: () => void;
}

export function superviseTelebirrAssignmentBrokerProcess(
  application: TelebirrAssignmentBrokerApplication,
  dependencies: TelebirrAssignmentBrokerProcessSupervisorDependencies = {},
): void {
  const processRuntime = dependencies.processRuntime ?? process;
  const reportRuntimeUnavailable =
    dependencies.reportRuntimeUnavailable ??
    (() => {
      console.error({
        component: 'telebirr_assignment_broker',
        event: 'runtime_unavailable',
        detailsRedacted: true,
      });
    });
  let stopping = false;
  let readinessCheckInFlight = false;
  let readinessTimer: NodeJS.Timeout | undefined;
  const detachSignalHandlers = (): void => {
    if (readinessTimer !== undefined) {
      clearInterval(readinessTimer);
      readinessTimer = undefined;
    }
    processRuntime.removeListener('SIGINT', close);
    processRuntime.removeListener('SIGTERM', close);
  };
  const close = (): void => {
    if (stopping) return;
    stopping = true;
    detachSignalHandlers();
    void application.close().catch(() => {
      processRuntime.exitCode = 1;
    });
  };
  const failFromRuntimeUnavailable = (): void => {
    if (stopping) return;
    stopping = true;
    detachSignalHandlers();
    processRuntime.exitCode = 1;
    reportRuntimeUnavailable();
    void application.close().catch(() => undefined);
  };
  processRuntime.once('SIGINT', close);
  processRuntime.once('SIGTERM', close);
  readinessTimer = setInterval(() => {
    if (stopping || readinessCheckInFlight) return;
    readinessCheckInFlight = true;
    void application
      .ready()
      .then((ready) => {
        if (!ready) failFromRuntimeUnavailable();
      })
      .catch(failFromRuntimeUnavailable)
      .finally(() => {
        readinessCheckInFlight = false;
      });
  }, TELEBIRR_ASSIGNMENT_BROKER_PROCESS_READINESS_INTERVAL_MILLISECONDS);
  readinessTimer.unref();
}

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
    superviseTelebirrAssignmentBrokerProcess(application);
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
