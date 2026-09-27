import {
  COMPANION_EXECUTION_LOCAL_EXPIRY_SAFETY_MARGIN_MS,
  COMPANION_EXECUTION_MAX_DATABASE_ACTIVATION_LIFETIME_MS,
} from '@fetanagent/agent-platform-companion-execution-contracts';

/** The signed handoff cannot extend the one-use database activation. */
export function selectGuardedExecutionDeadline(
  handoffExpiresAtMs: number,
  databaseDeadlineMs: number | undefined,
  nowMs = Date.now(),
): number {
  if (
    !Number.isSafeInteger(handoffExpiresAtMs) ||
    !Number.isSafeInteger(databaseDeadlineMs) ||
    !Number.isSafeInteger(nowMs) ||
    databaseDeadlineMs === undefined ||
    handoffExpiresAtMs <= nowMs ||
    databaseDeadlineMs <= nowMs ||
    databaseDeadlineMs - nowMs >
      COMPANION_EXECUTION_MAX_DATABASE_ACTIVATION_LIFETIME_MS +
        COMPANION_EXECUTION_LOCAL_EXPIRY_SAFETY_MARGIN_MS
  ) {
    throw new Error('The guarded execution deadline is unavailable.');
  }
  return Math.min(handoffExpiresAtMs, databaseDeadlineMs);
}
