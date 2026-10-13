-- Return a known same-customer, already-credited reference in the synchronous
-- Telegram capture reply. This uses only the existing protected-ledger predicate:
-- an in-flight or other-customer reference stays pending. It creates no new
-- payment claim, execution job, or grant and cannot cause a second credit.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $migration$
declare
  v_source text;
  v_old text;
  v_new text;
begin
  if pg_catalog.to_regprocedure(
    'app.routine_telebirr_same_customer_credited_reference(uuid)'
  ) is null then
    raise exception 'The protected completed-duplicate predicate is unavailable.';
  end if;
  select pg_catalog.pg_get_functiondef(
    'app.capture_telegram_routine_telebirr_untrusted_proof(uuid,text,text,text,text,text,smallint,smallint,text)'::pg_catalog.regprocedure
  ) into v_source;
  if v_source is null then
    raise exception 'The Telegram paid capture source is unavailable.';
  end if;

  v_old := 'return query select v_existing.id, ''telebirr''::text,'
    || E'\n                        '
    || '''paid_pending''::text, v_existing.submitted_at, true;';
  v_new := 'return query select v_existing.id, ''telebirr''::text,'
    || E'\n                        '
    || 'case when app.routine_telebirr_same_customer_credited_reference(v_existing.id)'
    || E'\n                          then ''already_used''::text'
    || E'\n                          else ''paid_pending''::text end,'
    || E'\n                        v_existing.submitted_at, true;';
  if pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_old, ''))
     <> pg_catalog.length(v_old) then
    raise exception 'The Telegram paid capture replay branch has changed.';
  end if;
  v_source := pg_catalog.replace(v_source, v_old, v_new);

  v_old := 'return query select v_inserted.id, ''telebirr''::text,'
    || E'\n                      '
    || '''paid_pending''::text, v_inserted.submitted_at, false;';
  v_new := 'return query select v_inserted.id, ''telebirr''::text,'
    || E'\n                      '
    || 'case when app.routine_telebirr_same_customer_credited_reference(v_inserted.id)'
    || E'\n                        then ''already_used''::text'
    || E'\n                        else ''paid_pending''::text end,'
    || E'\n                      v_inserted.submitted_at, false;';
  if pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_old, ''))
     <> pg_catalog.length(v_old) then
    raise exception 'The Telegram paid capture insert branch has changed.';
  end if;
  execute pg_catalog.replace(v_source, v_old, v_new);
end;
$migration$;

comment on function app.capture_telegram_routine_telebirr_untrusted_proof(
  uuid, text, text, text, text, text, smallint, smallint, text
) is 'Exact Player-action Telegram candidate entry point: synchronous already-used result only for the same customer and a previously executed protected reference; unverified references remain pending and no credit occurs here.';

commit;
