\set ON_ERROR_STOP on

-- A read-only last-moment cutover check. Financial switches stay live, so this
-- cannot prevent a new job after the snapshot; the runtime must still recover
-- interrupted work through its existing lease and reconciliation rules.
begin transaction isolation level serializable read only;
set local search_path = pg_catalog;
set local statement_timeout = '10s';
set local lock_timeout = '1s';

select not exists (
    select 1 from app.deposit_jobs job
    where job.status::text not in ('succeeded', 'cancelled')
      or job.lease_expires_at > pg_catalog.clock_timestamp()
  ) and not exists (
    select 1 from app.deposit_execution_attempts attempt
    where attempt.status::text not in (
      'cancelled_before_action',
      'confirmed_executed',
      'owner_test_closed_uncredited'
    )
  ) as cutover_idle
\gset
\if :cutover_idle
\else
  \warn 'An active or unresolved deposit operation blocks the live cutover.'
  select 1 / 0 as rejected;
\endif

rollback;
