\set ON_ERROR_STOP on
begin;
set local search_path = pg_catalog;
set local lock_timeout = '5s';
set local statement_timeout = '10s';

update app.routine_deposit_release_drain drain set
  release_sha = '',
  expires_at = '-infinity'::timestamptz,
  updated_at = pg_catalog.clock_timestamp()
where drain.singleton and drain.release_sha = :'release_sha';

select exists (
  select 1 from app.routine_deposit_release_drain drain
  where drain.singleton and drain.release_sha = ''
    and drain.expires_at = '-infinity'::timestamptz
) as release_drain_disarmed
\gset
\if :release_drain_disarmed
\else
  \warn 'The routine release drain was not cleared by this release.'
  select 1 / 0 as rejected;
\endif
commit;
