import {
  loadOwnerControlConfig,
  redactedOwnerControlConfigForLog,
} from '@fetanagent/config/owner-control';

import { buildOwnerControlApp } from './app.js';
import { FileOwnerKemerbetReadinessCohortControl } from './owner-kemerbet-readiness-cohort.js';
import { reconcileOwnerKemerbetReadinessRootReceipt } from './owner-kemerbet-readiness-reconciler.js';
import { createOwnerControlPostgresRuntime } from './postgres-runtime.js';

const config = loadOwnerControlConfig();
if (!config.runtime.enabled) throw new Error('The Owner-control staging runtime gate is disabled.');

const runtime = await createOwnerControlPostgresRuntime(config.runtime);
const kemerbetReadinessCohortControl = new FileOwnerKemerbetReadinessCohortControl();
const app = buildOwnerControlApp(config, { kemerbetReadinessCohortControl, runtime });
let activeReceiptReconciliation: Promise<void> | undefined;
let receiptReconciliationTimer: NodeJS.Timeout | undefined;
let completedReceiptReconciled = false;
const reconcileRootReceipt = (): Promise<void> => {
  if (completedReceiptReconciled) return Promise.resolve();
  if (activeReceiptReconciliation) return activeReceiptReconciliation;
  const reconciliation = (async () => {
    try {
      const result = await reconcileOwnerKemerbetReadinessRootReceipt(
        kemerbetReadinessCohortControl,
        runtime.kemerbetReadinessCohorts,
      );
      if (result === 'completed_recorded') {
        completedReceiptReconciled = true;
        if (receiptReconciliationTimer) clearInterval(receiptReconciliationTimer);
      }
    } catch {
      app.log.warn('KemerBet readiness root-receipt reconciliation is unavailable.');
    }
  })();
  activeReceiptReconciliation = reconciliation;
  void reconciliation.finally(() => {
    if (activeReceiptReconciliation === reconciliation) activeReceiptReconciliation = undefined;
  });
  return reconciliation;
};
let closing = false;
const closeGracefully = async () => {
  if (closing) return;
  closing = true;
  if (receiptReconciliationTimer) clearInterval(receiptReconciliationTimer);
  await activeReceiptReconciliation;
  try {
    await app.close();
  } catch {
    process.exitCode = 1;
  }
};
process.once('SIGINT', closeGracefully);
process.once('SIGTERM', closeGracefully);

app.log.info(
  { config: redactedOwnerControlConfigForLog(config) },
  'FetanAgent Owner-control service starting',
);
try {
  await reconcileRootReceipt();
  await app.listen({ host: config.server.host, port: config.server.port });
  if (!completedReceiptReconciled) {
    receiptReconciliationTimer = setInterval(() => {
      void reconcileRootReceipt();
    }, 5_000);
    receiptReconciliationTimer.unref();
  }
} catch {
  await closeGracefully();
  throw new Error('The Owner-control service could not start.');
}
