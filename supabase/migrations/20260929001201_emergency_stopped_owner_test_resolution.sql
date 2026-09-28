-- Preserve the Owner's one-use, no-credit/no-refund attestation requirement while
-- allowing the same protected closure after an emergency stop. The existing
-- function still checks the singular review, cancelled zero-attempt job, payment
-- claim, reservation, disabled financial authority, and absent assignments.
-- This migration changes only its exact stop-reason predicate; it invokes nothing.

begin;

do $migration$
declare
  target regprocedure :=
    'app.resolve_stopped_pilot_owner_test_payment(uuid,uuid,uuid,boolean,boolean)'::regprocedure;
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
    raise exception 'The Owner-funded test closure guard is not the reviewed source shape.';
  end if;

  execute pg_catalog.replace(definition, old_predicate, reviewed_predicate);

  definition := pg_catalog.pg_get_functiondef(target);
  if pg_catalog.strpos(definition, reviewed_predicate) = 0
    or pg_catalog.strpos(definition, old_predicate) <> 0 then
    raise exception 'The Owner-funded test closure guard did not reach the reviewed shape.';
  end if;
end;
$migration$;

comment on function app.resolve_stopped_pilot_owner_test_payment(
  uuid, uuid, uuid, boolean, boolean
) is
  'Postgres-only one-use closure for an Owner-attested self-funded test after Owner or emergency stop. It rejects the deposit, resolves the review case, and preserves the cancelled job, payment claim, and reservation; no money action is authorized.';

commit;
