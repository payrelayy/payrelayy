\set ON_ERROR_STOP on
begin;
set local search_path = pg_catalog;
set local lock_timeout = '10s';
set local statement_timeout = '15s';

update app.routine_deposit_release_drain drain set
  release_sha = :'release_sha',
  expires_at = pg_catalog.clock_timestamp() + interval '20 minutes',
  updated_at = pg_catalog.clock_timestamp()
where drain.singleton
  and (drain.expires_at <= pg_catalog.clock_timestamp()
    or drain.release_sha = :'release_sha');

select exists (
  select 1 from app.routine_deposit_release_drain drain
  where drain.singleton and drain.release_sha = :'release_sha'
    and drain.expires_at > pg_catalog.clock_timestamp()
) as release_drain_armed
\gset
\if :release_drain_armed
\else
  \warn 'Another release already holds the routine credit drain.'
  select 1 / 0 as rejected;
\endif
commit;
