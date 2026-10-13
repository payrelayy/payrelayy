-- Give the customer an honest, one-time update promptly when a paid reference
-- has not yet produced a verified intent. This does not reject a reference or
-- shorten the provider lookup / final notification window.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $migration$
declare
  v_source text;
  v_old constant text := 'interval ''3 minutes''';
  v_new constant text := 'interval ''30 seconds''';
begin
  select pg_catalog.pg_get_functiondef(
    'app.claim_telegram_deposit_outcome_notification()'::pg_catalog.regprocedure
  ) into v_source;
  if v_source is null
    or v_source not like '%notification_stage = ''checking''%'
    or v_source not like '%interval ''70 minutes''%'
    or (pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_old, '')))
       <> pg_catalog.length(v_old) then
    raise exception 'The Telegram checking notice implementation has changed.';
  end if;
  execute pg_catalog.replace(v_source, v_old, v_new);
end;
$migration$;

comment on function app.claim_telegram_deposit_outcome_notification() is
  'Bot-only bounded non-final unverified status after 30 seconds, verified waiting notice, and final outcome; never infers rejection from an untrusted reference.';

commit;
