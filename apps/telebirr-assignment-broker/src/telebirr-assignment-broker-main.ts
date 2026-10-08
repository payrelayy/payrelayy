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
import { loadRoutineNoMoneyConfig } from './routine-no-money-config.js';
import { createRoutineNoMoneyPostgresRuntime } from './routine-no-money-runtime.js';
import { createRoutineNoMoneyBroker } from './routine-no-money-broker.js';
import { createRoutineNoMoneyLocalHandler } from './routine-no-money-local-handler.js';
import { loadRoutinePaidPollConfig } from './routine-paid-poll-config.js';
import { createRoutinePaidPollPostgresRuntime } from './routine-paid-poll-runtime.js';
import { createRoutinePaidPollBroker } from './routine-paid-poll-broker.js';
import { createRoutinePaidPollLocalHandler } from './routine-paid-poll-local-handler.js';
import {
  createTelebirrAssignmentBrokerLocalUnixServer,
  type RoutineLocalHandler,
} from './local-telebirr-assignment-broker-server.js';

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
  const routine = loadRoutineNoMoneyConfig(environment, configDependencies);
  const paid = loadRoutinePaidPollConfig(environment, configDependencies);
  if (routine === undefined && paid === undefined) {
    return startTelebirrAssignmentBrokerApplication(config, applicationDependencies);
  }
  if (
    !config.enabled ||
    config.mode !== 'enrollment_only' ||
    applicationDependencies.createLocalServer !== undefined
  ) {
    throw new Error('The private routine TeleBirr broker is unavailable.');
  }
  const runtimes: Array<{ ready(): Promise<boolean>; close(): Promise<void> }> = [];
  try {
    const now = () => new Date().toISOString();
    let routineHandler: RoutineLocalHandler | undefined;
    if (routine !== undefined) {
      const runtime = await createRoutineNoMoneyPostgresRuntime(routine.connection);
      runtimes.push(runtime);
      routineHandler = createRoutineNoMoneyLocalHandler(
        createRoutineNoMoneyBroker({
          database: runtime.database,
          openingKey: routine.openingKey,
          signer: routine.signer,
          now,
        }),
      );
    }
    let paidHandler: RoutineLocalHandler | undefined;
    if (paid !== undefined) {
      const runtime = await createRoutinePaidPollPostgresRuntime(paid.connection);
      runtimes.push(runtime);
      paidHandler = createRoutinePaidPollLocalHandler(
        createRoutinePaidPollBroker({
          database: runtime.database,
          openingKey: paid.openingKey,
          signer: paid.signer,
          now,
        }),
      );
    }
    const application = await startTelebirrAssignmentBrokerApplication(config, {
      ...applicationDependencies,
      createLocalServer: (poll) =>
        createTelebirrAssignmentBrokerLocalUnixServer(poll, routineHandler, paidHandler),
    });
    let closePromise: Promise<void> | undefined;
    return Object.freeze({
      ready: async () =>
        (await application.ready()) &&
        (await Promise.all(runtimes.map((runtime) => runtime.ready()))).every(Boolean),
      close: () => {
        closePromise ??= (async () => {
          const closed = await Promise.allSettled([
            application.close(),
            ...runtimes.map((runtime) => runtime.close()),
          ]);
          if (closed.some((result) => result.status === 'rejected')) throw new Error();
        })();
        return closePromise;
      },
    });
  } catch {
    await Promise.allSettled(runtimes.map((runtime) => runtime.close()));
    throw new Error('The private routine TeleBirr broker is unavailable.');
  }
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
