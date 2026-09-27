import type { CompanionActivationSnapshotQuery } from './snapshot.js';

const EPOCH = /^[1-9][0-9]{0,18}$/u;
const MAX_BIGINT_EPOCH = 9_223_372_036_854_775_807n;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const QUERY_DEADLINE_MS = 5_000;
const RENEW_INTERVAL_MS = 10_000;
const MIN_REMAINING_MS = 25_000;
const MAX_REMAINING_MS = 50_000;

// The database activation trigger independently checks the same named jobs.
// This operator check additionally requires recent successful runs before any
// one-use transition is dispatched. A missing cron schema fails closed.
export const READY_SQL = `select (
  session_user = 'postgres' and current_user = 'postgres'
  and exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron')
  and (
    select pg_catalog.count(*) from (
      values
        ('fetanagent-companion-watchdog-credentials-v1',
         'select app.watchdog_fence_companion_execution_credentials()'),
        ('fetanagent-companion-watchdog-sessions-v1',
         'select app.watchdog_drain_companion_execution_sessions()'),
        ('fetanagent-companion-watchdog-financial-v1',
         'select app.watchdog_fence_companion_execution_financial_authority()')
    ) as required(jobname, command)
    join cron.job job on job.jobname = required.jobname
      and job.command = required.command
      and job.active and job.username = 'postgres'
      and job.database = pg_catalog.current_database()
      and job.schedule = '15 seconds'
  ) = 3
  and (
    select pg_catalog.count(*) from (
      select distinct on (job.jobname) job.jobname, run.status, run.end_time
        from cron.job job
        join cron.job_run_details run on run.jobid = job.jobid
       where job.jobname in (
         'fetanagent-companion-watchdog-credentials-v1',
         'fetanagent-companion-watchdog-sessions-v1',
         'fetanagent-companion-watchdog-financial-v1'
       )
       order by job.jobname, run.start_time desc
    ) recent
   where recent.status = 'succeeded'
     and recent.end_time >= pg_catalog.clock_timestamp() - interval '2 minutes'
  ) = 3
) as ready`;

export const RENEW_SQL = `select app.renew_agent_platform_companion_execution_watchdog(
  $1::bigint
) as lease_expires_at`;

export interface GuardedDatabaseWatchdogLeaseInput {
  /** Existing, short-lived protected administrator session; never the companion login. */
  readonly administrator: CompanionActivationSnapshotQuery;
  /** The epoch independently read from the exact one-use request. */
  readonly activationEpoch: string;
  readonly trustedNow: () => Date;
  readonly signal?: AbortSignal;
}

export interface GuardedDatabaseWatchdogLease {
  /** Check exact active jobs and their latest successful runs before transition. */
  confirmReady(): Promise<void>;
  /** Renew the newly committed lease before a local execution permit is sent. */
  onActivated(validUntil: string): Promise<void>;
  /** Rejects on any health, renewal, deadline, or operator-lifecycle loss. */
  readonly lost: Promise<never>;
}

export class GuardedDatabaseWatchdogLeaseUnavailableError extends Error {
  constructor() {
    super('The independent execution watchdog lease is unavailable.');
    this.name = 'GuardedDatabaseWatchdogLeaseUnavailableError';
  }
}

async function bounded<T>(task: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(task),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error()), QUERY_DEADLINE_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function exactTime(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

/**
 * Internal operator-side lease heartbeat. This is not a production entry point
 * or activation authority. The separately scheduled database jobs own the stop:
 * if this process dies, its timer stops and the unrenewed lease expires.
 */
export function prepareGuardedDatabaseWatchdogLease(
  input: GuardedDatabaseWatchdogLeaseInput,
): GuardedDatabaseWatchdogLease {
  if (
    !input ||
    !EPOCH.test(input.activationEpoch) ||
    BigInt(input.activationEpoch) > MAX_BIGINT_EPOCH ||
    !input.administrator ||
    typeof input.administrator.query !== 'function' ||
    typeof input.trustedNow !== 'function' ||
    input.signal?.aborted
  ) {
    throw new GuardedDatabaseWatchdogLeaseUnavailableError();
  }

  let confirmed = false;
  let activated = false;
  let failed = false;
  let hardExpiry = 0;
  let timer: NodeJS.Timeout | undefined;
  let rejectLost!: (error: GuardedDatabaseWatchdogLeaseUnavailableError) => void;
  const lost = new Promise<never>((_, reject) => {
    rejectLost = reject;
  });
  void lost.catch(() => undefined);

  const fail = (): GuardedDatabaseWatchdogLeaseUnavailableError => {
    if (!failed) {
      failed = true;
      clearTimeout(timer);
      rejectLost(new GuardedDatabaseWatchdogLeaseUnavailableError());
    }
    return new GuardedDatabaseWatchdogLeaseUnavailableError();
  };
  input.signal?.addEventListener('abort', fail, { once: true });

  const now = (): number => {
    const value = input.trustedNow();
    if (!exactTime(value)) throw new Error();
    return value.getTime();
  };

  const renew = async (): Promise<void> => {
    if (failed || !activated) throw new Error();
    const result = await bounded(() =>
      input.administrator.query(RENEW_SQL, [input.activationEpoch]),
    );
    if (result.rows.length !== 1) throw new Error();
    const row = result.rows[0];
    if (!row || Object.keys(row).length !== 1 || !exactTime(row['lease_expires_at'])) {
      throw new Error();
    }
    const remaining = row['lease_expires_at'].getTime() - now();
    if (
      remaining < MIN_REMAINING_MS ||
      remaining > MAX_REMAINING_MS ||
      row['lease_expires_at'].getTime() > hardExpiry
    ) {
      throw new Error();
    }
  };

  const schedule = (): void => {
    if (failed) return;
    timer = setTimeout(() => {
      void renew().then(schedule, fail);
    }, RENEW_INTERVAL_MS);
  };

  return Object.freeze({
    lost,
    async confirmReady(): Promise<void> {
      if (failed || confirmed || activated || input.signal?.aborted) throw fail();
      try {
        const result = await bounded(() => input.administrator.query(READY_SQL, []));
        if (
          failed ||
          result.rows.length !== 1 ||
          !result.rows[0] ||
          Object.keys(result.rows[0]).length !== 1 ||
          result.rows[0]['ready'] !== true
        ) {
          throw new Error();
        }
        confirmed = true;
      } catch {
        throw fail();
      }
    },
    async onActivated(validUntil: string): Promise<void> {
      if (failed || !confirmed || activated || input.signal?.aborted) throw fail();
      try {
        if (typeof validUntil !== 'string' || !UTC_TIMESTAMP.test(validUntil)) {
          throw new Error();
        }
        hardExpiry = Date.parse(validUntil);
        if (
          !Number.isFinite(hardExpiry) ||
          new Date(hardExpiry).toISOString() !== validUntil ||
          hardExpiry <= now() + MAX_REMAINING_MS
        ) {
          throw new Error();
        }
        activated = true;
        await renew();
        if (failed || input.signal?.aborted) throw new Error();
        schedule();
      } catch {
        throw fail();
      }
    },
  });
}
