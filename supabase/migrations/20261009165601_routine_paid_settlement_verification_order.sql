-- The paid settlement producer must enqueue in signed-observation completion order,
-- not in the order the customer originally transferred money. Keep the existing
-- private function signature and result column name for an inert rolling deploy;
-- occurred_at_utc now carries the inbox's verification-complete timestamp.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create index routine_paid_staging_verification_order_scan
  on app.routine_telebirr_paid_observation_staging (recorded_at, challenge_id);

do $migration$
declare
  v_definition text;
  v_source text;
  v_old_output constant text :=
    'pg_catalog.to_char(staged.occurred_at at time zone ''UTC''';
  v_new_output constant text :=
    'pg_catalog.to_char(staged.recorded_at at time zone ''UTC''';
  v_old_cursor constant text :=
    '(staged.occurred_at, staged.challenge_id) >';
  v_new_cursor constant text :=
    '(staged.recorded_at, staged.challenge_id) >';
  v_old_order constant text :=
    'order by staged.occurred_at, staged.challenge_id';
  v_new_order constant text :=
    'order by staged.recorded_at, staged.challenge_id';
  v_old_due constant text :=
    'and staged.occurred_at <= pg_catalog.clock_timestamp()';
  v_new_due constant text :=
    'and staged.occurred_at <= pg_catalog.clock_timestamp()' || pg_catalog.chr(10)
    || '     and staged.recorded_at <= pg_catalog.clock_timestamp()';
begin
  select routine.prosrc, pg_catalog.pg_get_functiondef(routine.oid)
    into v_source, v_definition
    from pg_catalog.pg_proc routine
   where routine.oid =
     'app.list_routine_telebirr_paid_settlement_candidates(timestamptz,uuid,integer)'
       ::pg_catalog.regprocedure
     and routine.proowner = 'postgres'::pg_catalog.regrole
     and routine.prosecdef and routine.prokind = 'f'
     and routine.proconfig = array['search_path=pg_catalog']::text[];
  if v_source is null or pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to(v_source, 'UTF8')), 'hex') <>
      'db7e95bc12eafb483e48552c2e5f9efad64e9816c8b9fe1038e5d8e4dfd5f019' then
    raise exception 'The paid settlement scan is not the reviewed definition.';
  end if;
  if pg_catalog.strpos(v_definition, v_old_output) = 0
    or pg_catalog.strpos(v_definition, v_old_cursor) = 0
    or pg_catalog.strpos(v_definition, v_old_order) = 0
    or pg_catalog.strpos(v_definition, v_old_due) = 0 then
    raise exception 'The paid settlement scan ordering patch is unavailable.';
  end if;
  execute pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
    pg_catalog.replace(v_definition, v_old_output, v_new_output),
    v_old_cursor, v_new_cursor), v_old_order, v_new_order), v_old_due, v_new_due);
end;
$migration$;

comment on function app.list_routine_telebirr_paid_settlement_candidates(
  timestamptz,uuid,integer) is
  'Bounded private scan ordered by signed-observation staging completion, then challenge ID. The legacy occurred_at_utc result field and first cursor argument carry recorded_at for rolling compatibility; receipt occurred_at remains a one-hour eligibility guard.';
commit;
