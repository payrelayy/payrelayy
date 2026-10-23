-- A held receipt can later receive a final rejection. Show its settled state
-- before the earlier hold so the Owner history and its guarded API agree.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $transactions_settled_history$
declare
  v_source text;
  v_old text;
  v_new text;
begin
  v_source := pg_catalog.pg_get_functiondef(
    'app.list_owner_routine_telebirr_transactions(uuid,text,date,date,text,integer,integer)'
      ::pg_catalog.regprocedure);
  v_old :=
    '        when fast_outcome = ''held_review'' then ''held_review''' || E'\n' ||
    '        when fast_outcome is not null or terminal_reason is not null' || E'\n' ||
    '          or intent_status in (''rejected'',''expired'',''cancelled'')' || E'\n' ||
    '          or (final_outcome is not null and final_outcome <> ''credited'')' || E'\n' ||
    '          then ''rejected''';
  v_new :=
    '        when (fast_outcome is not null and fast_outcome <> ''held_review'')' || E'\n' ||
    '          or terminal_reason is not null' || E'\n' ||
    '          or intent_status in (''rejected'',''expired'',''cancelled'')' || E'\n' ||
    '          or (final_outcome is not null and final_outcome <> ''credited'')' || E'\n' ||
    '          then ''rejected''' || E'\n' ||
    '        when fast_outcome = ''held_review'' then ''held_review''';
  if pg_catalog.length(v_source) -
      pg_catalog.length(pg_catalog.replace(v_source,v_old,'')) <>
      pg_catalog.length(v_old) then
    raise exception 'Owner TeleBirr history source changed.';
  end if;
  execute pg_catalog.replace(v_source,v_old,v_new);
end;
$transactions_settled_history$;

commit;
