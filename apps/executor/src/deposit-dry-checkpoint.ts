import {
  createDeterministicKemerBetDepositFixture,
  deterministicKemerBetDepositIds,
} from './deterministic-kemerbet-deposit-fixture.js';
import { createKemerBetDepositRuntime } from './kemerbet-deposit-runtime.js';

const fixture = createDeterministicKemerBetDepositFixture({ recoveredExpiredPrepared: true });
let browserResolutions = 0;
const runtime = createKemerBetDepositRuntime({
  database: fixture.database,
  browserForAgentAccount: async () => {
    browserResolutions += 1;
    return fixture.browser;
  },
  workerInstanceId: deterministicKemerBetDepositIds.workerInstanceId,
  leaseSeconds: 300,
  finalActionEnabled: false,
  now: fixture.now,
  log: () => undefined,
});

const result = await runtime.runOnce();
if (
  result.event !== 'recovery_circuit_open' ||
  result.workerDisposition !== 'pause' ||
  browserResolutions !== 0 ||
  fixture.stats.executionLeaseCalls !== 1 ||
  fixture.stats.transferClicks !== 0 ||
  fixture.stats.fenceCalls !== 0
) {
  throw new Error('The deterministic no-action checkpoint crossed a financial-action boundary.');
}
console.info(JSON.stringify(result));
