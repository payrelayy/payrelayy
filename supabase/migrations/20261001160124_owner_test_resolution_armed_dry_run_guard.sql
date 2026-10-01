-- A newer, unspent dry-run pilot has no payment or execution authority. Permit
-- closing the singular older Owner-funded review while that pilot stays armed,
-- but retain the exact-match switch, zero-reservation, and dormant-money guards.
-- This migration changes only the private closure function; it invokes nothing.
begin;

do $migration$
declare
  target regprocedure :=
    'app.resolve_stopped_pilot_owner_test_payment(uuid,uuid,uuid,boolean,boolean)'::regprocedure;
  definition text;
  old_predicate constant text :=
    'feature_switch.mode <> ''disabled'''
    || E'\n       or feature_switch.settings <> ''{}''::jsonb';
  reviewed_predicate constant text :=
    '(feature_switch.mode <> ''disabled'''
    || E'\n       or feature_switch.settings <> ''{}''::jsonb)'
    || E'\n       and not ('
    || E'\n         feature_switch.feature_key = ''private_live_deposit_pilot'''
    || E'\n         and feature_switch.mode = ''dry_run'''
    || E'\n         and exists ('
    || E'\n           select 1 from app.private_live_deposit_pilot_revisions current_pilot'
    || E'\n            where current_pilot.id = ('
    || E'\n                    select latest.id'
    || E'\n                      from app.private_live_deposit_pilot_revisions latest'
    || E'\n                     order by latest.created_at desc, latest.revision desc'
    || E'\n                     limit 1'
    || E'\n                  )'
    || E'\n              and current_pilot.status = ''armed'''
    || E'\n              and current_pilot.active_from <= pg_catalog.clock_timestamp()'
    || E'\n              and current_pilot.expires_at > pg_catalog.clock_timestamp()'
    || E'\n              and feature_switch.settings = pg_catalog.jsonb_build_object('
    || E'\n                ''contract_version'', 1,'
    || E'\n                ''pilot_revision_id'', current_pilot.id,'
    || E'\n                ''configuration_digest'', current_pilot.configuration_digest'
    || E'\n              )'
    || E'\n              and not exists ('
    || E'\n                select 1 from app.private_live_deposit_pilot_reservations current_reservation'
    || E'\n                 where current_reservation.pilot_revision_id = current_pilot.id'
    || E'\n              )'
    || E'\n         )'
    || E'\n       )';
  occurrences integer;
begin
  definition := pg_catalog.pg_get_functiondef(target);
  occurrences :=
    (pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition, old_predicate, '')))
      / pg_catalog.length(old_predicate);

  if occurrences <> 1
    or pg_catalog.strpos(definition, reviewed_predicate) <> 0 then
    raise exception 'The Owner-funded test financial guard is not the reviewed source shape.';
  end if;

  execute pg_catalog.replace(definition, old_predicate, reviewed_predicate);

  definition := pg_catalog.pg_get_functiondef(target);
  if pg_catalog.strpos(definition, reviewed_predicate) = 0 then
    raise exception 'The Owner-funded test financial guard did not reach the reviewed shape.';
  end if;
end;
$migration$;

comment on function app.resolve_stopped_pilot_owner_test_payment(
  uuid, uuid, uuid, boolean, boolean
) is
  'Postgres-only one-use closure for an Owner-attested self-funded stopped-pilot test. An unrelated latest pilot may remain armed only in exact, unspent dry_run state; all financial authorities remain dormant. No refund, credit, provider action, or queue execution is authorized.';

commit;
