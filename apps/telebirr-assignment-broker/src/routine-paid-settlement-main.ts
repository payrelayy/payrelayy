import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';

import { loadRoutinePaidSettlementConfig } from './routine-paid-settlement-config.js';
import {
  createRoutinePaidSettlementRuntime,
  type RoutinePaidSettlementRuntime,
} from './routine-paid-settlement-runtime.js';
import {
  runRoutinePaidSettlementPass,
  type RoutinePaidSettlementCandidate,
} from './routine-paid-settlement-worker.js';

export const ROUTINE_PAID_SETTLEMENT_INTERVAL_MILLISECONDS = 5_000;
export const ROUTINE_PAID_SETTLEMENT_HEARTBEAT_FILE =
  '/tmp/fetanagent-routine-paid-settlement.heartbeat';

export interface RoutinePaidSettlementProcess {
  readonly runtime: RoutinePaidSettlementRuntime;
  ready(): Promise<boolean>;
  close(): Promise<void>;
}

/** Independent process: neither the phone broker nor the bridge receives a settlement credential. */
export async function runRoutinePaidSettlementMain(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<RoutinePaidSettlementProcess> {
  const connection = loadRoutinePaidSettlementConfig(environment);
  const runtime = await createRoutinePaidSettlementRuntime(connection);
  let cursor: RoutinePaidSettlementCandidate | undefined;
  let inFlight = false;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  const stop = async () => {
    closePromise ??= (async () => {
      closed = true;
      clearInterval(timer);
      while (inFlight) await new Promise<void>((resolve) => setTimeout(resolve, 50));
      await runtime.close();
    })();
    return closePromise;
  };
  const tick = async () => {
    if (closed || inFlight) return;
    inFlight = true;
    try {
      const pass = await runRoutinePaidSettlementPass(runtime.database, cursor);
      cursor = pass.nextCursor;
      if (!(await runtime.ready())) throw new Error();
      writeFileSync(ROUTINE_PAID_SETTLEMENT_HEARTBEAT_FILE, `${Date.now()}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      if (pass.examined > 0)
        console.info({
          component: 'routine_paid_settlement',
          event: 'page_processed',
          examined: pass.examined,
          created: pass.created,
          alreadyFinalized: pass.alreadyFinalized,
          rejected: pass.rejected,
          detailsRedacted: true,
        });
    } catch {
      process.exitCode = 1;
      console.error({
        component: 'routine_paid_settlement',
        event: 'runtime_unavailable',
        detailsRedacted: true,
      });
      void stop();
    } finally {
      inFlight = false;
    }
  };
  const timer = setInterval(() => {
    void tick();
  }, ROUTINE_PAID_SETTLEMENT_INTERVAL_MILLISECONDS);
  timer.unref();
  void tick();
  return Object.freeze({ runtime, ready: () => runtime.ready(), close: stop });
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  try {
    const application = await runRoutinePaidSettlementMain();
    const close = () => {
      void application.close().catch(() => {
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    console.info({
      component: 'routine_paid_settlement',
      event: 'started',
      detailsRedacted: true,
    });
  } catch {
    console.error({
      component: 'routine_paid_settlement',
      event: 'startup_failed',
      detailsRedacted: true,
    });
    process.exitCode = 1;
  }
}
