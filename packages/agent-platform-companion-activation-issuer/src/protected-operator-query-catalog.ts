import { ACTIVATE_SQL } from './activation-transition.js';
import { RETAIN_SQL } from './attestation-retention.js';
import { READY_SQL, RENEW_SQL } from './guarded-database-watchdog-lease.js';
import { ATTESTATION_SQL } from './guarded-local-activation-channel.js';
import { APPROVED_JOB_SQL, OUTCOME_SQL } from './guarded-one-job-outcome.js';
import { ACQUIRE_SQL, RELEASE_SQL } from './guarded-operator-lifecycle-lock.js';
import { SNAPSHOT_SQL } from './snapshot.js';

/** Exact internal statements, not caller-supplied SQL or a general query proxy. */
export const protectedOperatorQueries = Object.freeze({
  acquire: ACQUIRE_SQL,
  release: RELEASE_SQL,
  snapshot: SNAPSHOT_SQL,
  retain: RETAIN_SQL,
  watchdogReady: READY_SQL,
  watchdogRenew: RENEW_SQL,
  attestation: ATTESTATION_SQL,
  activate: ACTIVATE_SQL,
  approvedJob: APPROVED_JOB_SQL,
  outcome: OUTCOME_SQL,
});

export type ProtectedOperatorQueryName = keyof typeof protectedOperatorQueries;

const entries = Object.entries(protectedOperatorQueries) as [ProtectedOperatorQueryName, string][];
if (new Set(entries.map(([, sql]) => sql)).size !== entries.length) {
  throw new Error('Protected operator query catalog is not unique.');
}
const namesByExactSql = new Map(entries.map(([name, sql]) => [sql, name]));

/** A different build's SQL fails closed rather than being forwarded to Postgres. */
export function protectedOperatorQueryName(sql: string): ProtectedOperatorQueryName | undefined {
  return namesByExactSql.get(sql);
}
