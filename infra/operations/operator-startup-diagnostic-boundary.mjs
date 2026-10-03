// A startup probe cannot grant authority or make an existing job executable.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function assertDormantStartupBoundary(status, scope) {
  if (
    !status ||
    typeof status !== 'object' ||
    Array.isArray(status) ||
    status.readOnly !== true ||
    status.identifiersRedacted !== true ||
    status.readinessOnly !== true ||
    status.activationAvailable !== false ||
    status.allFinancialSwitchesDisabled !== true ||
    status.companionExecutionControlDisabled !== true ||
    status.executionCapabilityDormant !== true ||
    status.companionExecutionRecords !== 0
  ) {
    throw new Error('The dormant startup boundary is unavailable.');
  }
  if (scope === 'empty_queue' && status.openJobs === 0) return;
  if (
    scope === 'preserve_one_stopped_pilot_job' &&
    status.openJobs === 1 &&
    status.untouchedQueuedJobs === 1 &&
    status.stoppedPilotUntouchedJob === true &&
    status.pilotState === 'stopped' &&
    status.effectiveTrustedEpochAvailable === false &&
    status.openExecutionReviewCases === 0 &&
    status.customerResolutionPending === false
  ) {
    return;
  }
  throw new Error('The dormant startup boundary is unavailable.');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 3) throw new Error();
    let raw = '';
    for await (const part of process.stdin) {
      raw += part;
      if (Buffer.byteLength(raw) > 16 * 1024) throw new Error();
    }
    assertDormantStartupBoundary(JSON.parse(raw), process.argv[2]);
    process.stdout.write('dormant_startup_boundary=ready\n');
  } catch {
    process.stderr.write('The dormant startup boundary is unavailable.\n');
    process.exitCode = 1;
  }
}
