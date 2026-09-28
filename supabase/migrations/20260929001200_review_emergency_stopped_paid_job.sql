-- Permit protected customer-resolution review after an emergency stop as well as an Owner stop.
-- The existing one-use function still requires the singular untouched paid job, no execution
-- attempt or companion assignment, and every financial authority disabled. This migration
-- rewrites only the exact stop-reason predicate and does not invoke the disposition.

begin;

do $migration$
declare
  target regprocedure :=
    'app.review_stopped_pilot_paid_execution_job(uuid,uuid,uuid,uuid)'::regprocedure;
  definition text;
  old_predicate constant text :=
    'or pilot.stop_reason_code <> ''owner_stop''';
  reviewed_predicate constant text :=
    'or pilot.stop_reason_code is null'
    || E'\n    or pilot.stop_reason_code not in (''owner_stop'', ''execution_uncertainty'')';
  occurrences integer;
begin
  definition := pg_catalog.pg_get_functiondef(target);
  occurrences :=
    (pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition, old_predicate, '')))
      / pg_catalog.length(old_predicate);

  if occurrences <> 1
    or pg_catalog.strpos(definition, reviewed_predicate) <> 0 then
    raise exception 'The stopped-pilot review guard is not the reviewed source shape.';
  end if;

  execute pg_catalog.replace(definition, old_predicate, reviewed_predicate);

  definition := pg_catalog.pg_get_functiondef(target);
  if pg_catalog.strpos(definition, reviewed_predicate) = 0
    or pg_catalog.strpos(definition, old_predicate) <> 0 then
    raise exception 'The stopped-pilot review guard did not reach the reviewed shape.';
  end if;
end;
$migration$;

comment on function app.review_stopped_pilot_paid_execution_job(uuid, uuid, uuid, uuid) is
  'Postgres-only, one-use stopped-pilot queue disposition after Owner or emergency stop. Cancels only one unleased zero-attempt paid job, preserves proof and reservation, opens execution review, and grants no execution or money authority.';

commit;
