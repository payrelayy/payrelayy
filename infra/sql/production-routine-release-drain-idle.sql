\set ON_ERROR_STOP on
begin transaction isolation level serializable read only;
set local search_path = pg_catalog;
set local lock_timeout = '1s';
set local statement_timeout = '10s';

select exists (
    select 1 from app.routine_deposit_release_drain drain
    where drain.singleton and drain.release_sha = :'release_sha'
      and drain.expires_at > pg_catalog.clock_timestamp()
  ) and not exists (
    select 1 from app.deposit_jobs job where job.status = 'leased'
  ) and not exists (
    select 1 from app.deposit_execution_attempts attempt
    where attempt.status in ('prepared', 'final_action_fenced', 'reconciliation_required')
      or (attempt.status = 'review_required' and not attempt.routine_review_isolated)
  ) as release_drain_idle
\gset
\if :release_drain_idle
\else
  \warn 'Routine credit work is still active or the release drain expired.'
  select 1 / 0 as rejected;
\endif
rollback;
