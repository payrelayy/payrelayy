-- A five-minute challenge remains uploadable for fifteen more minutes. Do not
-- issue the same candidate to another paid phone lane while that sealed upload
-- can still be accepted. Other candidates continue to use free lanes.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $migration$
declare
  v_source text;
  v_old text := 'challenge.expires_at > v_now';
  v_new text := 'challenge.expires_at + interval ''15 minutes'' > v_now';
begin
  select pg_catalog.pg_get_functiondef(
    'app.issue_routine_telebirr_paid_poll_assignment(uuid,uuid,text,timestamptz,uuid)'::pg_catalog.regprocedure
  ) into v_source;
  if v_source is null
    or pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_old, ''))
       <> pg_catalog.length(v_old) then
    raise exception 'The paid poll issuer source is not the reviewed version.';
  end if;
  execute pg_catalog.replace(v_source, v_old, v_new);

  select pg_catalog.pg_get_functiondef(
    'app.issue_routine_telebirr_paid_lookup_challenge(uuid,uuid,uuid)'::pg_catalog.regprocedure
  ) into v_source;
  v_old := 'or (select pg_catalog.count(*) from app.routine_telebirr_lookup_challenges challenge'
    || E'\n' || '          where challenge.candidate_id = v_candidate.id) >= 5 then';
  v_new := 'or exists (select 1 from app.routine_telebirr_lookup_challenges challenge'
    || E'\n' || '          where challenge.candidate_id = v_candidate.id'
    || E'\n' || '            and challenge.issuance_mode = ''paid'''
    || E'\n' || '            and challenge.expires_at + interval ''15 minutes'' > v_now)'
    || E'\n' || '    or (select pg_catalog.count(*) from app.routine_telebirr_lookup_challenges challenge'
    || E'\n' || '          where challenge.candidate_id = v_candidate.id) >= 5 then';
  if v_source is null
    or pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_old, ''))
       <> pg_catalog.length(v_old) then
    raise exception 'The paid challenge issuer source is not the reviewed version.';
  end if;
  execute pg_catalog.replace(v_source, v_old, v_new);
end;
$migration$;

comment on function app.issue_routine_telebirr_paid_poll_assignment(
  uuid,uuid,text,timestamptz,uuid) is
  'Paid phone poll: at most one assignment per candidate remains within its server-acceptable upload window; other candidates can use free phone lanes.';

commit;
